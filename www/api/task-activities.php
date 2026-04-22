<?php
/**
 * Task Activities API Endpoint
 *
 * GET /api/tasks/{id}/activities - Get activity log for a task
 */

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$taskId = getPathId(2);

if (!$userId) {
    jsonError('Unauthorized', 401);
}

try {
    switch ($method) {
        case 'GET':
            if (!$taskId) {
                jsonError('Task ID is required', 400);
            }

            // Check if user has access to this task's board
            $stmt = $pdo->prepare("
                SELECT t.board_id FROM tasks t
                JOIN boards b ON t.board_id = b.id
                LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = ?
                WHERE t.id = ? AND (b.user_id = ? OR bm.user_id = ?)
            ");
            $stmt->execute([$userId, $taskId, $userId, $userId]);
            if (!$stmt->fetch()) {
                jsonError('Task not found', 404);
            }

            // Get activities with user details
            $stmt = $pdo->prepare("
                SELECT ta.*, u.username, u.email
                FROM task_activities ta
                JOIN users u ON ta.user_id = u.id
                WHERE ta.task_id = ?
                ORDER BY ta.created_at DESC
                LIMIT 50
            ");
            $stmt->execute([$taskId]);
            $activities = $stmt->fetchAll();

            jsonResponse([
                'success' => true,
                'data' => $activities
            ]);
            break;

        default:
            jsonError('Method not allowed', 405);
    }
} catch (PDOException $e) {
    logError("Database error in task-activities.php", ['error' => $e->getMessage()]);
    jsonError('Database error', 500);
}
