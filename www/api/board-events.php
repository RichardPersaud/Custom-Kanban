<?php
/**
 * Board Events API - Server-Sent Events (SSE) Endpoint
 *
 * GET /api/board-events/{board_id} - Stream real-time updates for a board
 *
 * Events include:
 * - task_created, task_updated, task_deleted, task_moved
 * - column_created, column_updated, column_deleted, column_reordered
 */

require_once __DIR__ . '/config.php';

// Get board ID from path
$segments = getPathSegments();
$boardId = isset($segments[2]) ? (int)$segments[2] : null;

if (!$boardId) {
    jsonError('Board ID is required', 400);
}

// Check authentication
if (!$userId) {
    jsonError('Unauthorized', 401);
}

// Check if user has access to this board
if (!hasBoardAccess($boardId, $userId)) {
    jsonError('Board not found', 404);
}

// Set headers for SSE
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('Connection: keep-alive');
header('X-Accel-Buffering: no'); // Disable nginx buffering

// Disable output buffering completely
while (ob_get_level() > 0) {
    ob_end_flush();
}
ini_set('output_buffering', 'off');
ini_set('implicit_flush', true);

// Get last event ID from client (for reconnects)
$lastEventId = isset($_SERVER['HTTP_LAST_EVENT_ID']) ? (int)$_SERVER['HTTP_LAST_EVENT_ID'] : 0;

logDebug("SSE connection started for board $boardId, user $userId, lastEventId: $lastEventId");

// Send initial connection message
echo "event: connected\n";
echo "data: " . json_encode(['board_id' => $boardId, 'user_id' => $userId, 'timestamp' => time()]) . "\n\n";

// Explicitly flush output
if (ob_get_level()) ob_flush();
flush();

// Log that we sent the connected event
logDebug("SSE sent connected event");

$counter = 0;
$maxRuntime = 60; // Run for 60 seconds before disconnecting (client will reconnect)
$startTime = time();

while (true) {
    // Check if connection is still alive
    if (connection_aborted()) {
        logDebug("SSE connection aborted for board $boardId, user $userId");
        break;
    }

    // Check runtime limit
    if (time() - $startTime > $maxRuntime) {
        logDebug("SSE connection timeout for board $boardId, user $userId");
        break;
    }

    // Check for new events
    try {
        if ($lastEventId === 0) {
            // First connection - get recent events (last 5 minutes)
            $stmt = $pdo->prepare("
                SELECT * FROM board_events
                WHERE board_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
                ORDER BY id ASC
                LIMIT 100
            ");
            $stmt->execute([$boardId]);
        } else {
            // Reconnect or ongoing - get events after last seen
            $stmt = $pdo->prepare("
                SELECT * FROM board_events
                WHERE board_id = ? AND id > ?
                ORDER BY id ASC
                LIMIT 100
            ");
            $stmt->execute([$boardId, $lastEventId]);
        }

        $events = $stmt->fetchAll();

        if (count($events) > 0) {
            logDebug("SSE found " . count($events) . " events for board $boardId");
        }

        foreach ($events as $event) {
            // Skip events from the same user (they already see their own changes)
            if ($event['user_id'] == $userId) {
                $lastEventId = max($lastEventId, $event['id']);
                continue;
            }

            // Send the event
            $eventData = json_encode([
                'id' => $event['id'],
                'type' => $event['event_type'],
                'board_id' => $event['board_id'],
                'user_id' => $event['user_id'],
                'data' => json_decode($event['event_data'], true),
                'created_at' => $event['created_at']
            ]);

            echo "id: " . $event['id'] . "\n";
            echo "event: " . $event['event_type'] . "\n";
            echo "data: " . $eventData . "\n\n";

            // Explicitly flush output
            if (ob_get_level()) ob_flush();
            flush();

            $lastEventId = $event['id'];
        }

        // Send a heartbeat every 15 seconds to keep connection alive
        if ($counter % 15 === 0) {
            echo "event: heartbeat\n";
            echo "data: " . json_encode(['time' => time()]) . "\n\n";
            if (ob_get_level()) ob_flush();
            flush();
        }

    } catch (PDOException $e) {
        logError("Database error in board-events", ['error' => $e->getMessage()]);
        break;
    }

    $counter++;
    sleep(1); // Check every second
}

logDebug("SSE connection ended for board $boardId, user $userId");

/**
 * Check if user has access to a board
 */
function hasBoardAccess($boardId, $userId) {
    global $pdo;

    $stmt = $pdo->prepare("
        SELECT id FROM board_members
        WHERE board_id = ? AND user_id = ?
    ");
    $stmt->execute([$boardId, $userId]);
    if ($stmt->fetch()) {
        return true;
    }

    // Legacy check
    $stmt = $pdo->prepare("
        SELECT id FROM boards
        WHERE id = ? AND user_id = ?
    ");
    $stmt->execute([$boardId, $userId]);
    if ($stmt->fetch()) {
        return true;
    }

    return false;
}
