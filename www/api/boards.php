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

// Require authentication for all board operations
if (!$userId) {
    jsonError('Unauthorized', 401);
}

$method = $_SERVER['REQUEST_METHOD'];
$segments = getPathSegments();
$boardId = getPathId(2);

try {
    switch ($method) {
        case 'GET':
            logDebug("Fetching all boards for user_id=$userId");
            // Get boards where user is owner OR member via board_members
            $stmt = $pdo->prepare("
                SELECT DISTINCT b.*,
                       (SELECT COUNT(*) FROM columns c WHERE c.board_id = b.id) as column_count,
                       (SELECT COUNT(*) FROM tasks t WHERE t.board_id = b.id) as task_count,
                       bm.role as user_role
                FROM boards b
                LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = ?
                WHERE b.user_id = ? OR bm.user_id = ?
                ORDER BY b.updated_at DESC
            ");
            $stmt->execute([$userId, $userId, $userId]);
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

            // Add creator as owner in board_members
            $stmt = $pdo->prepare("
                INSERT INTO board_members (board_id, user_id, role, invited_by, accepted_at, created_at)
                VALUES (?, ?, 'owner', NULL, NOW(), NOW())
            ");
            $stmt->execute([$boardId, $userId]);

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

            // Check if user has access and can modify (owner or admin)
            $checkStmt = $pdo->prepare("
                SELECT bm.role FROM board_members bm
                WHERE bm.board_id = ? AND bm.user_id = ? AND bm.role IN ('owner', 'admin')
                UNION
                SELECT 'owner' as role FROM boards WHERE id = ? AND user_id = ?
            ");
            $checkStmt->execute([$boardId, $userId, $boardId, $userId]);
            if (!$checkStmt->fetch()) {
                jsonError('Board not found or permission denied', 404);
            }

            $fields = [];
            $values = [];
            if (isset($input['name'])) {
                $newName = trim($input['name']);
                // Check for duplicate name (only check boards user has access to)
                $dupStmt = $pdo->prepare("
                    SELECT b.id FROM boards b
                    LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = ?
                    WHERE b.name = ? AND b.id != ? AND (b.user_id = ? OR bm.user_id = ?)
                ");
                $dupStmt->execute([$userId, $newName, $boardId, $userId, $userId]);
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

            // Check ownership - only owners can delete
            $checkStmt = $pdo->prepare("
                SELECT bm.role FROM board_members bm
                WHERE bm.board_id = ? AND bm.user_id = ? AND bm.role = 'owner'
                UNION
                SELECT 'owner' as role FROM boards WHERE id = ? AND user_id = ?
            ");
            $checkStmt->execute([$boardId, $userId, $boardId, $userId]);
            if (!$checkStmt->fetch()) {
                jsonError('Board not found or permission denied', 404);
            }

            // Delete all tasks in this board
            $stmt = $pdo->prepare("DELETE FROM tasks WHERE board_id = ?");
            $stmt->execute([$boardId]);
            logDebug("Deleted tasks for board $boardId");

            // Delete all columns in this board
            $stmt = $pdo->prepare("DELETE FROM columns WHERE board_id = ?");
            $stmt->execute([$boardId]);
            logDebug("Deleted columns for board $boardId");

            // Delete all board members
            $stmt = $pdo->prepare("DELETE FROM board_members WHERE board_id = ?");
            $stmt->execute([$boardId]);
            logDebug("Deleted board_members for board $boardId");

            // Delete all invitations
            $stmt = $pdo->prepare("DELETE FROM board_invitations WHERE board_id = ?");
            $stmt->execute([$boardId]);
            logDebug("Deleted invitations for board $boardId");

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