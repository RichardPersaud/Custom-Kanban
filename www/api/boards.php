<?php
/**
 * Boards API Endpoint
 *
 * GET    /api/boards           - List all boards for current user
 * POST   /api/boards           - Create a new board
 * PUT    /api/boards/{id}      - Update board (rename)
 * DELETE /api/boards/{id}      - Delete board and all its columns/tasks
 */

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$segments = getPathSegments();
$boardId = getPathId(2);

try {
    switch ($method) {
        case 'GET':
            logDebug("Fetching all boards for user_id=$userId");
            $stmt = $pdo->prepare("
                SELECT b.*,
                       (SELECT COUNT(*) FROM columns c WHERE c.board_id = b.id) as column_count,
                       (SELECT COUNT(*) FROM tasks t WHERE t.board_id = b.id) as task_count
                FROM boards b
                WHERE b.user_id = ? OR b.user_id IS NULL
                ORDER BY b.updated_at DESC
            ");
            $stmt->execute([$userId]);
            $boards = $stmt->fetchAll();
            jsonResponse(['success' => true, 'data' => $boards]);
            break;

        case 'POST':
            $input = getJsonInput();
            if ($input === null) {
                jsonError('Invalid JSON in request body', 400);
            }

            $name = isset($input['name']) ? trim($input['name']) : 'Untitled Board';
            if (empty($name)) {
                $name = 'Untitled Board';
            }

            // Check for duplicate name
            $dupStmt = $pdo->prepare("SELECT id FROM boards WHERE name = ? AND (user_id = ? OR user_id IS NULL)");
            $dupStmt->execute([$name, $userId]);
            if ($dupStmt->fetch()) {
                jsonError('A board with this name already exists', 409);
            }

            $stmt = $pdo->prepare("
                INSERT INTO boards (name, user_id, created_at, updated_at)
                VALUES (?, ?, NOW(), NOW())
            ");
            $stmt->execute([$name, $userId]);
            $boardId = $pdo->lastInsertId();

            logDebug("Board created with ID: $boardId");

            $stmt = $pdo->prepare("SELECT * FROM boards WHERE id = ?");
            $stmt->execute([$boardId]);
            $board = $stmt->fetch();

            jsonResponse(['success' => true, 'data' => $board], 201);
            break;

        case 'PUT':
        case 'PATCH':
            if (!$boardId) {
                jsonError('Board ID is required', 400);
            }

            $input = getJsonInput();
            if ($input === null) {
                jsonError('Invalid JSON in request body', 400);
            }

            // Check ownership
            $checkStmt = $pdo->prepare("SELECT id FROM boards WHERE id = ? AND (user_id = ? OR user_id IS NULL)");
            $checkStmt->execute([$boardId, $userId]);
            if (!$checkStmt->fetch()) {
                jsonError('Board not found', 404);
            }

            $fields = [];
            $values = [];
            if (isset($input['name'])) {
                $newName = trim($input['name']);
                // Check for duplicate name (excluding current board)
                $dupStmt = $pdo->prepare("SELECT id FROM boards WHERE name = ? AND id != ? AND (user_id = ? OR user_id IS NULL)");
                $dupStmt->execute([$newName, $boardId, $userId]);
                if ($dupStmt->fetch()) {
                    jsonError('A board with this name already exists', 409);
                }
                $fields[] = 'name = ?';
                $values[] = $newName;
            }
            if (empty($fields)) {
                jsonError('No fields to update', 400);
            }

            $values[] = $boardId;
            $sql = "UPDATE boards SET " . implode(', ', $fields) . ", updated_at = NOW() WHERE id = ?";
            $stmt = $pdo->prepare($sql);
            $stmt->execute($values);

            $stmt = $pdo->prepare("SELECT * FROM boards WHERE id = ?");
            $stmt->execute([$boardId]);
            $board = $stmt->fetch();

            jsonResponse(['success' => true, 'data' => $board]);
            break;

        case 'DELETE':
            if (!$boardId) {
                jsonError('Board ID is required', 400);
            }

            // Check ownership
            $checkStmt = $pdo->prepare("SELECT id FROM boards WHERE id = ? AND (user_id = ? OR user_id IS NULL)");
            $checkStmt->execute([$boardId, $userId]);
            if (!$checkStmt->fetch()) {
                jsonError('Board not found', 404);
            }

            // Delete all tasks in this board
            $stmt = $pdo->prepare("DELETE FROM tasks WHERE board_id = ?");
            $stmt->execute([$boardId]);
            logDebug("Deleted tasks for board $boardId");

            // Delete all columns in this board
            $stmt = $pdo->prepare("DELETE FROM columns WHERE board_id = ?");
            $stmt->execute([$boardId]);
            logDebug("Deleted columns for board $boardId");

            // Delete the board
            $stmt = $pdo->prepare("DELETE FROM boards WHERE id = ?");
            $stmt->execute([$boardId]);

            logDebug("Board $boardId deleted");
            jsonResponse(['success' => true, 'message' => 'Board deleted']);
            break;

        default:
            jsonError('Method not allowed', 405);
    }
} catch (PDOException $e) {
    logError("Database error in boards.php", ['error' => $e->getMessage(), 'code' => $e->getCode()]);
    jsonError('Database error', 500, ['details' => $e->getMessage()]);
} catch (Exception $e) {
    logError("Unexpected error in boards.php", ['error' => $e->getMessage()]);
    jsonError('Internal server error', 500, ['details' => $e->getMessage()]);
}