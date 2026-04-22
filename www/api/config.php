<?php
/**
 * Kanban API Configuration
 * Shared config for all API endpoints
 */

// CORS headers - MUST be first
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Access-Control-Max-Age: 86400');

// Handle preflight OPTIONS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Prevent any output before headers
ob_start();

// Error reporting for debugging (log only, not display)
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

// Custom error log file
$logFile = __DIR__ . '/../log.txt';

/**
 * Log a debug message
 */
function logDebug($message) {
    global $logFile;
    $timestamp = date('[Y-m-d H:i:s]');
    $backtrace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 2);
    $caller = isset($backtrace[1]) ? basename($backtrace[1]['file']) . ':' . $backtrace[1]['line'] : 'unknown';
    $entry = "$timestamp [DEBUG] [$caller] $message" . PHP_EOL;
    @file_put_contents($logFile, $entry, FILE_APPEND | LOCK_EX);
}

/**
 * Log an error
 */
function logError($message, $context = []) {
    global $logFile;
    $timestamp = date('[Y-m-d H:i:s]');
    $backtrace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 2);
    $caller = isset($backtrace[1]) ? basename($backtrace[1]['file']) . ':' . $backtrace[1]['line'] : 'unknown';
    $contextStr = !empty($context) ? ' Context: ' . json_encode($context) : '';
    $entry = "$timestamp [ERROR] [$caller] $message$contextStr" . PHP_EOL;
    @file_put_contents($logFile, $entry, FILE_APPEND | LOCK_EX);
    error_log("[Kanban API] $caller: $message");
}

logDebug("=== API Request Start ===");
logDebug("Method: " . $_SERVER['REQUEST_METHOD'] . " | URI: " . $_SERVER['REQUEST_URI']);
logDebug("Headers: " . json_encode(getallheaders()));

// Database connection
$dbPath = __DIR__ . '/../db.php';
if (!file_exists($dbPath)) {
    logError("Database config not found at: $dbPath");
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Database configuration error']);
    exit;
}

try {
    require_once $dbPath;
} catch (Exception $e) {
    logError("Database connection failed: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Database connection failed']);
    exit;
}

if (!isset($pdo)) {
    logError("PDO variable not set after including db.php");
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Database not initialized']);
    exit;
}

// Start session only if not already started
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// Get user ID if authenticated - allow guest access
$userId = $_SESSION['user_id'] ?? null;

// If no session, auto-create guest session for reads
if (!$userId) {
    $_SESSION['user_id'] = 1;
    $_SESSION['guest_mode'] = true;
    $userId = 1;
    logDebug("Auto-created guest session (user_id=1)");
} else {
    logDebug("Authenticated as user_id=$userId");
}

// Helper to check if write operations require real auth
function requireRealAuth() {
    if ($_SESSION['guest_mode'] ?? false) {
        jsonError('Please log in to perform this action', 401);
    }
    return $_SESSION['user_id'];
}

/**
 * Send JSON response
 */
function jsonResponse($data, $statusCode = 200) {
    logDebug("Response [HTTP $statusCode]: " . json_encode($data));
    http_response_code($statusCode);
    echo json_encode($data, JSON_PRETTY_PRINT);
    exit;
}

/**
 * Send error response
 */
function jsonError($message, $statusCode = 400, $details = null) {
    logError("API Error [HTTP $statusCode]: $message", $details ? ['details' => $details] : []);
    $response = ['success' => false, 'error' => $message];
    if ($details !== null) {
        $response['details'] = $details;
    }
    jsonResponse($response, $statusCode);
}

/**
 * Get JSON input from request body
 */
function getJsonInput() {
    $rawInput = file_get_contents('php://input');
    logDebug("Raw input: " . ($rawInput ?: "(empty)"));
    
    $data = json_decode($rawInput, true);
    if ($rawInput && $data === null) {
        logError("JSON decode failed", ['raw' => $rawInput, 'json_error' => json_last_error_msg()]);
        return null;
    }
    return $data ?: [];
}

/**
 * Broadcast an event to all connected clients for a board
 *
 * @param int $boardId The board ID
 * @param string $eventType Event type (e.g., 'task_created', 'task_updated')
 * @param array $eventData Data associated with the event
 * @param int|null $userId User who triggered the event (null for current user)
 */
function broadcastEvent($boardId, $eventType, $eventData, $userId = null) {
    global $pdo;

    if (!$userId) {
        $userId = $_SESSION['user_id'] ?? null;
    }

    if (!$userId) {
        logDebug("Cannot broadcast event: no user ID");
        return false;
    }

    try {
        $stmt = $pdo->prepare("
            INSERT INTO board_events (board_id, user_id, event_type, event_data, created_at)
            VALUES (?, ?, ?, ?, NOW())
        ");
        $stmt->execute([$boardId, $userId, $eventType, json_encode($eventData)]);

        // Clean up old events (keep last 1000 per board)
        $pdo->exec("
            DELETE FROM board_events
            WHERE board_id = $boardId
            AND id < (
                SELECT id FROM (
                    SELECT id FROM board_events
                    WHERE board_id = $boardId
                    ORDER BY id DESC
                    LIMIT 1 OFFSET 1000
                ) tmp
            )
        ");

        // Also broadcast via WebSocket for real-time updates
        $wsMessage = [
            'type' => $eventType,
            'data' => $eventData,
            'user_id' => $userId
        ];
        broadcastToBoardWebSocket($boardId, $wsMessage);

        return true;
    } catch (PDOException $e) {
        logError("Failed to broadcast event", ['error' => $e->getMessage()]);
        return false;
    }
}

/**
 * Broadcast a message to all users on a board via WebSocket
 * Connects to the WebSocket server and sends a broadcast message
 *
 * @param int $boardId Target board ID
 * @param array $message Message to send
 * @return bool Success status
 */
function broadcastToBoardWebSocket($boardId, $message) {
    $wsHost = 'kanban-websocket';
    $wsPort = 8080;
    $secret = 'kanban_admin_secret';

    $payload = json_encode([
        'type' => 'admin_broadcast',
        'secret' => $secret,
        'target_type' => 'board',
        'target_id' => $boardId,
        'message' => $message
    ]);

    // Create socket connection
    $socket = @fsockopen($wsHost, $wsPort, $errno, $errstr, 5);
    if (!$socket) {
        logDebug("Failed to connect to WebSocket server: $errstr ($errno)");
        return false;
    }

    // WebSocket handshake
    $key = base64_encode(openssl_random_pseudo_bytes(16));
    $headers = "GET / HTTP/1.1\r\n";
    $headers .= "Host: $wsHost:$wsPort\r\n";
    $headers .= "Upgrade: websocket\r\n";
    $headers .= "Connection: Upgrade\r\n";
    $headers .= "Sec-WebSocket-Key: $key\r\n";
    $headers .= "Sec-WebSocket-Version: 13\r\n";
    $headers .= "\r\n";

    fwrite($socket, $headers);

    // Read handshake response
    $response = '';
    while (!feof($socket)) {
        $line = fgets($socket, 1024);
        $response .= $line;
        if (trim($line) === '') break;
    }

    if (strpos($response, '101 Switching Protocols') === false) {
        logDebug("WebSocket handshake failed: $response");
        fclose($socket);
        return false;
    }

    // Send the message frame
    $length = strlen($payload);
    if ($length <= 125) {
        $frame = chr(0x81) . chr($length) . $payload;
    } elseif ($length <= 65535) {
        $frame = chr(0x81) . chr(126) . pack('n', $length) . $payload;
    } else {
        $frame = chr(0x81) . chr(127) . pack('NN', 0, $length) . $payload;
    }

    fwrite($socket, $frame);
    fclose($socket);

    logDebug("WebSocket broadcast sent to board $boardId");
    return true;
}

/**
 * Send a WebSocket notification to a specific user
 * Connects to the WebSocket server and sends an admin_broadcast message
 *
 * @param int $userId Target user ID
 * @param array $message Message to send
 * @return bool Success status
 */
function notifyUserWebSocket($userId, $message) {
    $wsHost = 'kanban-websocket';
    $wsPort = 8080;
    $secret = 'kanban_admin_secret';

    $payload = json_encode([
        'type' => 'admin_broadcast',
        'secret' => $secret,
        'target_type' => 'user',
        'target_id' => $userId,
        'message' => $message
    ]);

    // Create socket connection
    $socket = @fsockopen($wsHost, $wsPort, $errno, $errstr, 5);
    if (!$socket) {
        logDebug("Failed to connect to WebSocket server: $errstr ($errno)");
        return false;
    }

    // WebSocket handshake
    $key = base64_encode(openssl_random_pseudo_bytes(16));
    $headers = "GET / HTTP/1.1\r\n";
    $headers .= "Host: $wsHost:$wsPort\r\n";
    $headers .= "Upgrade: websocket\r\n";
    $headers .= "Connection: Upgrade\r\n";
    $headers .= "Sec-WebSocket-Key: $key\r\n";
    $headers .= "Sec-WebSocket-Version: 13\r\n";
    $headers .= "\r\n";

    fwrite($socket, $headers);

    // Read handshake response
    $response = '';
    while (!feof($socket)) {
        $line = fgets($socket, 1024);
        $response .= $line;
        if (trim($line) === '') break;
    }

    if (strpos($response, '101 Switching Protocols') === false) {
        logDebug("WebSocket handshake failed: $response");
        fclose($socket);
        return false;
    }

    // Send the message frame
    $length = strlen($payload);
    if ($length <= 125) {
        $frame = chr(0x81) . chr($length) . $payload;
    } elseif ($length <= 65535) {
        $frame = chr(0x81) . chr(126) . pack('n', $length) . $payload;
    } else {
        $frame = chr(0x81) . chr(127) . pack('NN', 0, $length) . $payload;
    }

    fwrite($socket, $frame);
    fclose($socket);

    logDebug("WebSocket notification sent to user $userId");
    return true;
}

/**
 * Get URL path segments
 */
function getPathSegments() {
    $uri = $_SERVER['REQUEST_URI'];
    $path = parse_url($uri, PHP_URL_PATH);
    $segments = explode('/', trim($path, '/'));
    logDebug("Path segments: " . json_encode($segments));
    return $segments;
}

/**
 * Get ID from URL path (e.g., /api/tasks/123)
 */
function getPathId($position = 2) {
    $segments = getPathSegments();
    $id = isset($segments[$position]) ? (int)$segments[$position] : null;
    logDebug("Extracted ID from position $position: " . ($id ?: "null"));
    return $id;
}

/**
 * Require authentication
 */
function requireAuth() {
    if (!isset($_SESSION['user_id'])) {
        jsonError('Unauthorized', 401);
    }
    return $_SESSION['user_id'];
}
