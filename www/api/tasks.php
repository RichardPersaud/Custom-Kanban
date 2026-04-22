<?php
/**
 * Tasks API Endpoint
 * 
 * GET    /api/tasks              - List all tasks
 * POST   /api/tasks              - Create new task
 * PUT    /api/tasks/{id}         - Update task
 * DELETE /api/tasks/{id}         - Delete task
 * POST   /api/tasks/{id}/move    - Move task to different column
 * POST   /api/tasks/{id}/position - Update task position
 */

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$segments = getPathSegments();
$taskId = getPathId(2);

// Require authentication only for write operations
if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'])) {
    requireRealAuth();
}

$method = $_SERVER['REQUEST_METHOD'];
$segments = getPathSegments();
$taskId = getPathId(2);

// Check for action suffix (move, position)
$action = null;
if (count($segments) >= 4 && $taskId) {
    $action = $segments[3];
}

try {
    // Handle move action
    if ($action === 'move' && $method === 'POST') {
        if (!$taskId) {
            jsonError('Task ID is required', 400);
        }
        
        $input = getJsonInput();
        if ($input === null || !isset($input['status'])) {
            jsonError('Status is required', 400);
        }
        
        $newStatus = (int)$input['status'];
        logDebug("Moving task $taskId to status $newStatus");
        
        // Check if task exists and user has access to its board
        $stmt = $pdo->prepare("
            SELECT t.id, t.board_id FROM tasks t
            LEFT JOIN board_members bm ON t.board_id = bm.board_id AND bm.user_id = ?
            WHERE t.id = ? AND (t.user_id = ? OR bm.user_id = ?)
        ");
        $stmt->execute([$userId, $taskId, $userId, $userId]);
        if (!$stmt->fetch()) {
            jsonError('Task not found', 404);
        }

        // Get the board_id for the task
        $stmt = $pdo->prepare("SELECT board_id FROM tasks WHERE id = ?");
        $stmt->execute([$taskId]);
        $taskInfo = $stmt->fetch();
        $boardId = $taskInfo ? $taskInfo['board_id'] : null;

        // Update task status
        $stmt = $pdo->prepare("UPDATE tasks SET status = ? WHERE id = ?");
        $stmt->execute([$newStatus, $taskId]);

        logDebug("Task $taskId moved to status $newStatus");

        // Broadcast the move event
        if ($boardId) {
            broadcastEvent($boardId, 'task_moved', [
                'task_id' => $taskId,
                'new_status' => $newStatus
            ]);
        }

        // Fetch updated task
        $stmt = $pdo->prepare("
            SELECT t.*, c.name as status_name, c.color as status_color
            FROM tasks t
            LEFT JOIN columns c ON t.status = c.id
            WHERE t.id = ?
        ");
        $stmt->execute([$taskId]);
        $task = $stmt->fetch();

        jsonResponse(['success' => true, 'data' => $task]);
    }
    
    // Handle position update
    if ($action === 'position' && $method === 'POST') {
        if (!$taskId) {
            jsonError('Task ID is required', 400);
        }
        
        $input = getJsonInput();
        if ($input === null || !isset($input['position'])) {
            jsonError('Position is required', 400);
        }
        
        $position = (int)$input['position'];
        logDebug("Updating task $taskId position to $position");
        
        // Check if task exists and user has access
        $stmt = $pdo->prepare("
            SELECT t.id, t.board_id FROM tasks t
            LEFT JOIN board_members bm ON t.board_id = bm.board_id AND bm.user_id = ?
            WHERE t.id = ? AND (t.user_id = ? OR bm.user_id = ?)
        ");
        $stmt->execute([$userId, $taskId, $userId, $userId]);
        if (!$stmt->fetch()) {
            jsonError('Task not found', 404);
        }

        // Update task position
        $stmt = $pdo->prepare("UPDATE tasks SET position = ? WHERE id = ?");
        $stmt->execute([$position, $taskId]);
        
        logDebug("Task $taskId position updated to $position");
        
        jsonResponse(['success' => true, 'message' => 'Position updated']);
    }
    
    // Handle standard CRUD operations
    switch ($method) {
        case 'GET':
            logDebug("Fetching all tasks for user_id=$userId");

            if (isset($_GET['board_id'])) {
                $boardId = (int)$_GET['board_id'];
                // Only show tasks from boards user has access to
                $stmt = $pdo->prepare("
                    SELECT t.*, c.name as status_name, c.color as status_color
                    FROM tasks t
                    LEFT JOIN columns c ON t.status = c.id
                    JOIN boards b ON t.board_id = b.id
                    LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = ?
                    WHERE t.board_id = ? AND (b.user_id = ? OR bm.user_id = ?)
                    ORDER BY t.position ASC, t.created_at DESC
                ");
                $stmt->execute([$userId, $boardId, $userId, $userId]);
            } else {
                // Show tasks from all boards user has access to
                $stmt = $pdo->prepare("
                    SELECT t.*, c.name as status_name, c.color as status_color
                    FROM tasks t
                    LEFT JOIN columns c ON t.status = c.id
                    JOIN boards b ON t.board_id = b.id
                    LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = ?
                    WHERE (t.user_id = ? OR t.user_id IS NULL) AND (b.user_id = ? OR bm.user_id = ?)
                    ORDER BY t.position ASC, t.created_at DESC
                ");
                $stmt->execute([$userId, $userId, $userId, $userId]);
            }
            $tasks = $stmt->fetchAll();
            
            logDebug("Found " . count($tasks) . " tasks");
            jsonResponse(['success' => true, 'data' => $tasks]);
            break;
            
        case 'POST':
            $input = getJsonInput();
            if ($input === null) {
                jsonError('Invalid JSON in request body', 400);
            }
            
            logDebug("Creating task with input: " . json_encode($input));
            
            // Validate required fields
            if (empty($input['title'])) {
                jsonError('Title is required', 400);
            }
            
            // Extract fields with defaults
            $title = trim($input['title']);
            $description = $input['description'] ?? '';
            $status = isset($input['status']) ? (int)$input['status'] : 1;
            $priority = $input['priority'] ?? 'medium';
            $tags = isset($input['tags']) ? (is_array($input['tags']) ? json_encode($input['tags']) : $input['tags']) : null;
            $dueDate = isset($input['due_date']) && $input['due_date'] ? $input['due_date'] : null;
            $boardId = isset($input['board_id']) ? (int)$input['board_id'] : null;

            // Validate status exists
            $checkCol = $pdo->prepare("SELECT id FROM columns WHERE id = ?");
            $checkCol->execute([$status]);
            if (!$checkCol->fetch()) {
                logDebug("Status column $status not found, defaulting to 1");
                $status = 1;
            }

            // Get max position for this status to add at end
            $maxPosStmt = $pdo->prepare("SELECT MAX(position) as max_pos FROM tasks WHERE status = ?");
            $maxPosStmt->execute([$status]);
            $maxPos = $maxPosStmt->fetch();
            $position = ($maxPos['max_pos'] ?? 0) + 1;

            $stmt = $pdo->prepare("
                INSERT INTO tasks (title, description, status, priority, tags, due_date, position, board_id, user_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ");
            $stmt->execute([$title, $description, $status, $priority, $tags, $dueDate, $position, $boardId, $userId]);

            $taskId = $pdo->lastInsertId();
            logDebug("Task created with ID: $taskId");

            // Log activity
            $actStmt = $pdo->prepare("
                INSERT INTO task_activities (task_id, user_id, action, created_at)
                VALUES (?, ?, 'created', NOW())
            ");
            $actStmt->execute([$taskId, $userId]);

            // Fetch the created task
            $stmt = $pdo->prepare("
                SELECT t.*, c.name as status_name, c.color as status_color
                FROM tasks t
                LEFT JOIN columns c ON t.status = c.id
                WHERE t.id = ?
            ");
            $stmt->execute([$taskId]);
            $task = $stmt->fetch();

            // Broadcast task creation
            if ($boardId) {
                broadcastEvent($boardId, 'task_created', [
                    'task_id' => $taskId,
                    'task' => $task
                ]);
            }

            jsonResponse(['success' => true, 'data' => $task], 201);
            break;
            
        case 'PUT':
        case 'PATCH':
            if (!$taskId) {
                jsonError('Task ID is required', 400);
            }
            
            $input = getJsonInput();
            if ($input === null) {
                jsonError('Invalid JSON in request body', 400);
            }
            
            logDebug("Updating task $taskId with: " . json_encode($input));
            
            // Check if task exists and user has access to its board
            $stmt = $pdo->prepare("
                SELECT t.id, t.board_id, t.user_id, bm.role as board_role FROM tasks t
                LEFT JOIN board_members bm ON t.board_id = bm.board_id AND bm.user_id = ?
                LEFT JOIN boards b ON t.board_id = b.id
                WHERE t.id = ? AND (t.user_id = ? OR b.user_id = ? OR bm.user_id = ?)
            ");
            $stmt->execute([$userId, $taskId, $userId, $userId, $userId]);
            $taskInfo = $stmt->fetch();
            if (!$taskInfo) {
                jsonError('Task not found', 404);
            }

            // Log the activity
            $activityData = json_encode(['fields_updated' => array_keys($input)]);
            $actStmt = $pdo->prepare("
                INSERT INTO task_activities (task_id, user_id, action, created_at)
                VALUES (?, ?, 'updated', NOW())
            ");
            $actStmt->execute([$taskId, $userId]);
            
            // Build dynamic update
            $fields = [];
            $values = [];
            
            if (isset($input['title'])) {
                $fields[] = 'title = ?';
                $values[] = trim($input['title']);
            }
            if (array_key_exists('description', $input)) {
                $fields[] = 'description = ?';
                $values[] = $input['description'];
            }
            if (isset($input['status'])) {
                $fields[] = 'status = ?';
                $values[] = (int)$input['status'];
            }
            if (isset($input['priority'])) {
                $fields[] = 'priority = ?';
                $values[] = $input['priority'];
            }
            if (array_key_exists('tags', $input)) {
                $fields[] = 'tags = ?';
                $values[] = is_array($input['tags']) ? json_encode($input['tags']) : $input['tags'];
            }
            if (array_key_exists('due_date', $input)) {
                $fields[] = 'due_date = ?';
                $values[] = $input['due_date'] ?: null;
            }
            if (isset($input['position'])) {
                $fields[] = 'position = ?';
                $values[] = (int)$input['position'];
            }
            if (array_key_exists('board_id', $input)) {
                $fields[] = 'board_id = ?';
                $values[] = $input['board_id'] ?: null;
            }

            if (empty($fields)) {
                jsonError('No fields to update', 400);
            }
            
            $values[] = $taskId;
            $sql = "UPDATE tasks SET " . implode(', ', $fields) . " WHERE id = ?";
            
            $stmt = $pdo->prepare($sql);
            $stmt->execute($values);
            
            logDebug("Task $taskId updated successfully");

            // Fetch updated task with board_id
            $stmt = $pdo->prepare("
                SELECT t.*, c.name as status_name, c.color as status_color
                FROM tasks t
                LEFT JOIN columns c ON t.status = c.id
                WHERE t.id = ?
            ");
            $stmt->execute([$taskId]);
            $task = $stmt->fetch();

            // Broadcast task update
            if ($task && $task['board_id']) {
                broadcastEvent($task['board_id'], 'task_updated', [
                    'task_id' => $taskId,
                    'task' => $task,
                    'updated_fields' => array_keys($input)
                ]);
            }

            jsonResponse(['success' => true, 'data' => $task]);
            break;
            
        case 'DELETE':
            if (!$taskId) {
                jsonError('Task ID is required', 400);
            }

            logDebug("Deleting task $taskId");

            // Check if task exists and user can delete (task owner OR board admin/owner)
            $stmt = $pdo->prepare("
                SELECT t.id, t.user_id, t.board_id, bm.role as board_role FROM tasks t
                LEFT JOIN board_members bm ON t.board_id = bm.board_id AND bm.user_id = ?
                LEFT JOIN boards b ON t.board_id = b.id
                WHERE t.id = ? AND (
                    t.user_id = ? OR
                    bm.role IN ('owner', 'admin') OR
                    b.user_id = ?
                )
            ");
            $stmt->execute([$userId, $taskId, $userId, $userId]);
            $taskInfo = $stmt->fetch();
            if (!$taskInfo) {
                jsonError('Task not found or permission denied', 404);
            }

            $boardId = $taskInfo['board_id'];

            $stmt = $pdo->prepare("DELETE FROM tasks WHERE id = ?");
            $stmt->execute([$taskId]);

            // Broadcast task deletion
            if ($boardId) {
                broadcastEvent($boardId, 'task_deleted', [
                    'task_id' => $taskId
                ]);
            }

            logDebug("Task $taskId deleted");
            jsonResponse(['success' => true, 'message' => 'Task deleted']);
            break;
            
        default:
            jsonError('Method not allowed', 405);
    }
} catch (PDOException $e) {
    logError("Database error in tasks.php", ['error' => $e->getMessage(), 'code' => $e->getCode()]);
    jsonError('Database error', 500, ['details' => $e->getMessage()]);
} catch (Exception $e) {
    logError("Unexpected error in tasks.php", ['error' => $e->getMessage()]);
    jsonError('Internal server error', 500, ['details' => $e->getMessage()]);
}
