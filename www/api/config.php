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

// Ensure user authentication (dev mode: auto-create session)
if (!isset($_SESSION['user_id'])) {
    $_SESSION['user_id'] = 1;
    logDebug("Auto-created session for user_id=1 (dev mode)");
}
$userId = $_SESSION['user_id'];
logDebug("Authenticated as user_id=$userId");

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
