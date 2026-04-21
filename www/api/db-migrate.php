<?php
/**
 * Database Migration Script
 * Adds missing columns to existing tables
 */

require_once __DIR__ . '/config.php';

$errors = [];
$success = [];

try {
    // Check if tasks table exists
    $tablesStmt = $pdo->query("SHOW TABLES LIKE 'tasks'");
    if ($tablesStmt->rowCount() === 0) {
        // Create tasks table
        $pdo->exec("
            CREATE TABLE tasks (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                status INT DEFAULT 1,
                priority VARCHAR(20) DEFAULT 'medium',
                position INT DEFAULT 0,
                tags JSON NULL,
                due_date DATETIME NULL,
                user_id INT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_status (status),
                INDEX idx_user_id (user_id)
            )
        ");
        $success[] = "Created tasks table";
    } else {
        // Check and add columns to tasks table
        $columns = $pdo->query("SHOW COLUMNS FROM tasks")->fetchAll(PDO::FETCH_COLUMN);
        
        if (!in_array('priority', $columns)) {
            $pdo->exec("ALTER TABLE tasks ADD COLUMN priority VARCHAR(20) DEFAULT 'medium' AFTER status");
            $success[] = "Added priority column to tasks table";
        }
        
        if (!in_array('position', $columns)) {
            $pdo->exec("ALTER TABLE tasks ADD COLUMN position INT DEFAULT 0 AFTER priority");
            $success[] = "Added position column to tasks table";
        }
        
        if (!in_array('tags', $columns)) {
            $pdo->exec("ALTER TABLE tasks ADD COLUMN tags JSON NULL AFTER position");
            $success[] = "Added tags column to tasks table";
        }
        
        if (!in_array('due_date', $columns)) {
            $pdo->exec("ALTER TABLE tasks ADD COLUMN due_date DATETIME NULL AFTER tags");
            $success[] = "Added due_date column to tasks table";
        }
        
        if (!in_array('user_id', $columns)) {
            $pdo->exec("ALTER TABLE tasks ADD COLUMN user_id INT DEFAULT NULL AFTER due_date");
            $success[] = "Added user_id column to tasks table";
        }
        
        if (!in_array('updated_at', $columns)) {
            $pdo->exec("ALTER TABLE tasks ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
            $success[] = "Added updated_at column to tasks table";
        }
    }
    
    // Check if columns table exists
    $columnsTableStmt = $pdo->query("SHOW TABLES LIKE 'columns'");
    if ($columnsTableStmt->rowCount() === 0) {
        // Create columns table
        $pdo->exec("
            CREATE TABLE columns (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                position INT DEFAULT 0,
                color VARCHAR(7) DEFAULT '#4361ee',
                user_id INT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_position (position),
                INDEX idx_user_id (user_id)
            )
        ");
        $success[] = "Created columns table";
        
        // Insert default columns matching frontend
        $defaultColumns = [
            ['To Do', 1, '#6b7280'],
            ['In Progress', 2, '#3b82f6'],
            ['Review', 3, '#eab308'],
            ['Done', 4, '#22c55e']
        ];
        $stmt = $pdo->prepare("INSERT INTO columns (name, position, color, user_id) VALUES (?, ?, ?, ?)");
        foreach ($defaultColumns as $col) {
            $stmt->execute([$col[0], $col[1], $col[2], 1]);
        }
        $success[] = "Inserted default columns";
    } else {
        // Check and add columns to columns table
        $columns = $pdo->query("SHOW COLUMNS FROM columns")->fetchAll(PDO::FETCH_COLUMN);
        
        if (!in_array('color', $columns)) {
            $pdo->exec("ALTER TABLE columns ADD COLUMN color VARCHAR(7) DEFAULT '#4361ee' AFTER position");
            $success[] = "Added color column to columns table";
        }
        
        if (!in_array('user_id', $columns)) {
            $pdo->exec("ALTER TABLE columns ADD COLUMN user_id INT DEFAULT NULL AFTER color");
            $success[] = "Added user_id column to columns table";
        }
    }
    
    // Check if boards table exists
    $boardsTableStmt = $pdo->query("SHOW TABLES LIKE 'boards'");
    if ($boardsTableStmt->rowCount() === 0) {
        $pdo->exec("
            CREATE TABLE boards (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                user_id INT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_user_id (user_id)
            )
        ");
        $success[] = "Created boards table";
    }

    // Add board_id to columns table
    $columnsCols = $pdo->query("SHOW COLUMNS FROM columns")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('board_id', $columnsCols)) {
        $pdo->exec("ALTER TABLE columns ADD COLUMN board_id INT DEFAULT NULL AFTER user_id");
        $pdo->exec("ALTER TABLE columns ADD INDEX idx_columns_board_id (board_id)");
        $success[] = "Added board_id to columns table";
    }

    // Add board_id to tasks table
    $tasksCols = $pdo->query("SHOW COLUMNS FROM tasks")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('board_id', $tasksCols)) {
        $pdo->exec("ALTER TABLE tasks ADD COLUMN board_id INT DEFAULT NULL AFTER user_id");
        $pdo->exec("ALTER TABLE tasks ADD INDEX idx_tasks_board_id (board_id)");
        $success[] = "Added board_id to tasks table";
    }

    // Check if users table exists
    $usersTableStmt = $pdo->query("SHOW TABLES LIKE 'users'");
    if ($usersTableStmt->rowCount() === 0) {
        $pdo->exec("
            CREATE TABLE users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) NOT NULL UNIQUE,
                email VARCHAR(100) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ");
        $success[] = "Created users table";
    }
    
    jsonResponse([
        'success' => true, 
        'messages' => $success, 
        'errors' => $errors,
        'timestamp' => date('Y-m-d H:i:s')
    ]);
    
} catch (PDOException $e) {
    logError("Migration failed: " . $e->getMessage());
    jsonError('Migration failed: ' . $e->getMessage(), 500);
}
