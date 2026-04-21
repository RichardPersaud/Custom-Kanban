<?php
/**
 * Columns API Endpoint
 * 
 * GET    /api/columns           - List all columns
 * POST   /api/columns           - Create column
 * PUT    /api/columns/{id}      - Update column
 * DELETE /api/columns/{id}      - Delete column
 * POST   /api/columns/{id}/move - Move column to new position
 */

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$segments = getPathSegments();

// Extract column ID from path: api/columns/123 or api/columns/123/move
$columnId = null;
$isMoveAction = false;

if (count($segments) >= 3 && is_numeric($segments[2])) {
    $columnId = (int)$segments[2];
    // Check for /move suffix
    if (count($segments) >= 4 && $segments[3] === 'move') {
        $isMoveAction = true;
    }
}

try {
    // Handle move action
    if ($isMoveAction && $method === 'POST') {
        if (!$columnId) {
            jsonError('Column ID is required', 400);
        }
        
        $input = getJsonInput();
        if ($input === null) {
            jsonError('Invalid JSON in request body', 400);
        }
        
        if (!isset($input['position']) || !is_numeric($input['position'])) {
            jsonError('Position is required and must be numeric', 400);
        }
        
        $newPosition = (int)$input['position'];
        logDebug("Moving column $columnId to position $newPosition");
        
        // Check if column exists
        $checkStmt = $pdo->prepare("SELECT id, position FROM columns WHERE id = ? AND (user_id = ? OR user_id IS NULL)");
        $checkStmt->execute([$columnId, $userId]);
        $column = $checkStmt->fetch();
        
        if (!$column) {
            jsonError('Column not found', 404);
        }
        
        $oldPosition = $column['position'];
        
        // Reorder other columns
        if ($newPosition > $oldPosition) {
            // Moving down: decrement positions between old and new
            $stmt = $pdo->prepare("
                UPDATE columns 
                SET position = position - 1 
                WHERE user_id = ? 
                AND position > ? 
                AND position <= ?
            ");
            $stmt->execute([$userId, $oldPosition, $newPosition]);
        } else if ($newPosition < $oldPosition) {
            // Moving up: increment positions between new and old
            $stmt = $pdo->prepare("
                UPDATE columns 
                SET position = position + 1 
                WHERE user_id = ? 
                AND position >= ? 
                AND position < ?
            ");
            $stmt->execute([$userId, $newPosition, $oldPosition]);
        }
        
        // Update the moved column
        $stmt = $pdo->prepare("UPDATE columns SET position = ? WHERE id = ?");
        $stmt->execute([$newPosition, $columnId]);
        
        logDebug("Column $columnId moved from position $oldPosition to $newPosition");
        
        // Return updated column
        $stmt = $pdo->prepare("
            SELECT c.*, COUNT(t.id) as task_count 
            FROM columns c 
            LEFT JOIN tasks t ON c.id = t.status
            WHERE c.id = ?
            GROUP BY c.id
        ");
        $stmt->execute([$columnId]);
        $column = $stmt->fetch();
        
        jsonResponse(['success' => true, 'data' => $column]);
    }
    
    // Handle standard CRUD operations
    switch ($method) {
        case 'GET':
            logDebug("Fetching all columns for user_id=$userId");

            if (isset($_GET['board_id'])) {
                $boardId = (int)$_GET['board_id'];
                $stmt = $pdo->prepare("
                    SELECT c.*, COUNT(t.id) as task_count
                    FROM columns c
                    LEFT JOIN tasks t ON c.id = t.status AND t.board_id = ?
                    WHERE c.board_id = ?
                    GROUP BY c.id
                    ORDER BY c.position ASC, c.created_at ASC
                ");
                $stmt->execute([$boardId, $boardId]);
            } else {
                $stmt = $pdo->prepare("
                    SELECT c.*, COUNT(t.id) as task_count
                    FROM columns c
                    LEFT JOIN tasks t ON c.id = t.status
                    WHERE c.user_id = ? OR c.user_id IS NULL
                    GROUP BY c.id
                    ORDER BY c.position ASC, c.created_at ASC
                ");
                $stmt->execute([$userId]);
            }
            $columns = $stmt->fetchAll();
            
            logDebug("Found " . count($columns) . " columns");
            jsonResponse(['success' => true, 'data' => $columns]);
            break;

        case 'POST':
            $input = getJsonInput();
            if ($input === null) {
                jsonError('Invalid JSON in request body', 400);
            }
            
            logDebug("Creating column with input: " . json_encode($input));
            
            $name = isset($input['name']) ? trim($input['name']) : null;
            $position = isset($input['position']) ? (int)$input['position'] : 0;
            $color = $input['color'] ?? '#4361ee';
            $boardId = isset($input['board_id']) ? (int)$input['board_id'] : null;
            
            if (!$name) {
                jsonError('Name is required', 400);
            }
            
            // If position not specified, put at the end
            if ($position === 0) {
                $maxPosStmt = $pdo->prepare("SELECT MAX(position) as max_pos FROM columns WHERE user_id = ?");
                $maxPosStmt->execute([$userId]);
                $maxPos = $maxPosStmt->fetch();
                $position = ($maxPos['max_pos'] ?? 0) + 1;
            }
            
            // Shift existing columns to make room
            $shiftStmt = $pdo->prepare("
                UPDATE columns 
                SET position = position + 1 
                WHERE user_id = ? AND position >= ?
            ");
            $shiftStmt->execute([$userId, $position]);
            
            $stmt = $pdo->prepare("
                INSERT INTO columns (name, position, color, user_id, board_id, created_at)
                VALUES (?, ?, ?, ?, ?, NOW())
            ");
            $stmt->execute([$name, $position, $color, $userId, $boardId]);
            
            $columnId = $pdo->lastInsertId();
            logDebug("Column created with ID: $columnId");
            
            // Return created column
            $stmt = $pdo->prepare("SELECT * FROM columns WHERE id = ?");
            $stmt->execute([$columnId]);
            $column = $stmt->fetch();
            
            jsonResponse(['success' => true, 'data' => $column], 201);
            break;

        case 'PUT':
        case 'PATCH':
            if (!$columnId) {
                jsonError('Column ID is required', 400);
            }
            
            $input = getJsonInput();
            if ($input === null) {
                jsonError('Invalid JSON in request body', 400);
            }
            
            logDebug("Updating column $columnId with: " . json_encode($input));
            
            // Check if column exists
            $checkStmt = $pdo->prepare("SELECT id FROM columns WHERE id = ? AND (user_id = ? OR user_id IS NULL)");
            $checkStmt->execute([$columnId, $userId]);
            if (!$checkStmt->fetch()) {
                jsonError('Column not found', 404);
            }
            
            // Build update query dynamically
            $fields = [];
            $values = [];
            
            if (isset($input['name'])) {
                $fields[] = 'name = ?';
                $values[] = trim($input['name']);
            }
            if (isset($input['position'])) {
                $fields[] = 'position = ?';
                $values[] = (int)$input['position'];
            }
            if (isset($input['color'])) {
                $fields[] = 'color = ?';
                $values[] = $input['color'];
            }
            if (array_key_exists('board_id', $input)) {
                $fields[] = 'board_id = ?';
                $values[] = $input['board_id'] ?: null;
            }
            
            if (empty($fields)) {
                jsonError('No fields to update', 400);
            }
            
            $values[] = $columnId;
            
            $sql = "UPDATE columns SET " . implode(', ', $fields) . " WHERE id = ?";
            $stmt = $pdo->prepare($sql);
            $stmt->execute($values);
            
            logDebug("Column $columnId updated");
            
            // Return updated column
            $stmt = $pdo->prepare("
                SELECT c.*, COUNT(t.id) as task_count 
                FROM columns c 
                LEFT JOIN tasks t ON c.id = t.status
                WHERE c.id = ?
                GROUP BY c.id
            ");
            $stmt->execute([$columnId]);
            $column = $stmt->fetch();
            
            jsonResponse(['success' => true, 'data' => $column]);
            break;

        case 'DELETE':
            if (!$columnId) {
                jsonError('Column ID is required', 400);
            }
            
            logDebug("Deleting column $columnId");
            
            // Check if column exists
            $checkStmt = $pdo->prepare("SELECT id, position FROM columns WHERE id = ? AND (user_id = ? OR user_id IS NULL)");
            $checkStmt->execute([$columnId, $userId]);
            $column = $checkStmt->fetch();
            
            if (!$column) {
                jsonError('Column not found', 404);
            }
            
            // Delete all tasks in this column first
            $deleteTasksStmt = $pdo->prepare("DELETE FROM tasks WHERE status = ?");
            $deleteTasksStmt->execute([$columnId]);
            $tasksDeleted = $deleteTasksStmt->rowCount();
            logDebug("Deleted $tasksDeleted tasks from column $columnId");
            
            // Delete the column
            $stmt = $pdo->prepare("DELETE FROM columns WHERE id = ?");
            $stmt->execute([$columnId]);
            
            // Reorder remaining columns
            $reorderStmt = $pdo->prepare("
                UPDATE columns 
                SET position = position - 1 
                WHERE user_id = ? AND position > ?
            ");
            $reorderStmt->execute([$userId, $column['position']]);
            
            logDebug("Column $columnId deleted successfully");
            jsonResponse(['success' => true, 'message' => 'Column and all associated tasks deleted']);
            break;

        default:
            jsonError('Method not allowed', 405);
    }
} catch (PDOException $e) {
    logError("Database error in columns.php", ['error' => $e->getMessage(), 'code' => $e->getCode()]);
    jsonError('Database error', 500, ['details' => $e->getMessage()]);
} catch (Exception $e) {
    logError("Unexpected error in columns.php", ['error' => $e->getMessage()]);
    jsonError('Internal server error', 500, ['details' => $e->getMessage()]);
}
