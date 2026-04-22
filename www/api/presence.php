<?php
/**
 * User Presence API Endpoint
 * Tracks which users are currently active on boards
 *
 * POST /api/presence/heartbeat        - Update user presence
 * GET  /api/presence/board/{board_id} - Get active users on board
 */

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$segments = getPathSegments();

if (!$userId) {
    jsonError('Unauthorized', 401);
}

try {
    // Cleanup stale presence records (older than 2 minutes)
    $pdo->exec("DELETE FROM user_presence WHERE last_seen < DATE_SUB(NOW(), INTERVAL 2 MINUTE)");

    switch ($method) {
        case 'POST':
            // POST /api/presence/heartbeat
            $input = getJsonInput();
            $boardId = isset($input['board_id']) ? (int)$input['board_id'] : null;
            $taskId = isset($input['task_id']) ? (int)$input['task_id'] : null;
            $fieldName = isset($input['field_name']) ? trim($input['field_name']) : null;

            if (!$boardId) {
                jsonError('Board ID is required', 400);
            }

            // Verify user has access to this board
            $stmt = $pdo->prepare("
                SELECT b.id FROM boards b
                LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = ?
                WHERE b.id = ? AND (b.user_id = ? OR bm.user_id = ?)
            ");
            $stmt->execute([$userId, $boardId, $userId, $userId]);
            if (!$stmt->fetch()) {
                jsonError('Board not found', 404);
            }

            // Update or insert presence
            $stmt = $pdo->prepare("
                INSERT INTO user_presence (user_id, board_id, task_id, field_name, last_seen, is_active)
                VALUES (?, ?, ?, ?, NOW(), TRUE)
                ON DUPLICATE KEY UPDATE
                task_id = VALUES(task_id),
                field_name = VALUES(field_name),
                last_seen = NOW(),
                is_active = TRUE
            ");
            $stmt->execute([$userId, $boardId, $taskId, $fieldName]);

            jsonResponse(['success' => true, 'message' => 'Presence updated']);
            break;

        case 'GET':
            // GET /api/presence/board/{board_id}
            $boardId = isset($segments[3]) && $segments[2] === 'board' ? (int)$segments[3] : null;
            if (!$boardId) {
                jsonError('Board ID is required', 400);
            }

            // Verify user has access to this board
            $stmt = $pdo->prepare("
                SELECT b.id FROM boards b
                LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = ?
                WHERE b.id = ? AND (b.user_id = ? OR bm.user_id = ?)
            ");
            $stmt->execute([$userId, $boardId, $userId, $userId]);
            if (!$stmt->fetch()) {
                jsonError('Board not found', 404);
            }

            // Get active users (last seen within 2 minutes)
            $stmt = $pdo->prepare("
                SELECT up.*, u.username, u.email
                FROM user_presence up
                JOIN users u ON up.user_id = u.id
                WHERE up.board_id = ? AND up.last_seen > DATE_SUB(NOW(), INTERVAL 2 MINUTE)
                ORDER BY up.last_seen DESC
            ");
            $stmt->execute([$boardId]);
            $activeUsers = $stmt->fetchAll();

            jsonResponse([
                'success' => true,
                'data' => $activeUsers
            ]);
            break;

        default:
            jsonError('Method not allowed', 405);
    }
} catch (PDOException $e) {
    logError("Database error in presence.php", ['error' => $e->getMessage()]);
    jsonError('Database error', 500);
}
