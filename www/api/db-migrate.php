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
                google_id VARCHAR(100) NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ");
        $success[] = "Created users table";
    }

    // ===== COLLABORATION FEATURE TABLES =====

    // Create board_members table
    $boardMembersTableStmt = $pdo->query("SHOW TABLES LIKE 'board_members'");
    if ($boardMembersTableStmt->rowCount() === 0) {
        $pdo->exec("
            CREATE TABLE board_members (
                id INT AUTO_INCREMENT PRIMARY KEY,
                board_id INT NOT NULL,
                user_id INT NOT NULL,
                role ENUM('owner', 'admin', 'member') DEFAULT 'member',
                invited_by INT DEFAULT NULL,
                invitation_token VARCHAR(64) DEFAULT NULL,
                invitation_email VARCHAR(100) DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                accepted_at DATETIME NULL,
                INDEX idx_board_id (board_id),
                INDEX idx_user_id (user_id),
                INDEX idx_invitation_token (invitation_token),
                UNIQUE KEY unique_board_member (board_id, user_id)
            )
        ");
        $success[] = "Created board_members table";
    }

    // Create board_invitations table
    $invitationsTableStmt = $pdo->query("SHOW TABLES LIKE 'board_invitations'");
    if ($invitationsTableStmt->rowCount() === 0) {
        $pdo->exec("
            CREATE TABLE board_invitations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                board_id INT NOT NULL,
                email VARCHAR(100) NOT NULL,
                role ENUM('admin', 'member') DEFAULT 'member',
                invited_by INT NOT NULL,
                token VARCHAR(64) NOT NULL UNIQUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL,
                accepted_by INT DEFAULT NULL,
                accepted_at DATETIME NULL,
                INDEX idx_board_id (board_id),
                INDEX idx_token (token),
                INDEX idx_email (email)
            )
        ");
        $success[] = "Created board_invitations table";
    }

    // Create task_activities table
    $activitiesTableStmt = $pdo->query("SHOW TABLES LIKE 'task_activities'");
    if ($activitiesTableStmt->rowCount() === 0) {
        $pdo->exec("
            CREATE TABLE task_activities (
                id INT AUTO_INCREMENT PRIMARY KEY,
                task_id INT NOT NULL,
                user_id INT NOT NULL,
                action ENUM('created', 'updated', 'deleted', 'moved', 'assigned') NOT NULL,
                field_name VARCHAR(50) NULL,
                old_value TEXT NULL,
                new_value TEXT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_task_id (task_id),
                INDEX idx_user_id (user_id),
                INDEX idx_created_at (created_at)
            )
        ");
        $success[] = "Created task_activities table";
    }

    // Create user_presence table
    $presenceTableStmt = $pdo->query("SHOW TABLES LIKE 'user_presence'");
    if ($presenceTableStmt->rowCount() === 0) {
        $pdo->exec("
            CREATE TABLE user_presence (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                board_id INT NOT NULL,
                task_id INT NULL,
                field_name VARCHAR(50) NULL,
                last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE,
                INDEX idx_board_id (board_id),
                INDEX idx_user_id (user_id),
                INDEX idx_last_seen (last_seen),
                UNIQUE KEY unique_user_board (user_id, board_id)
            )
        ");
        $success[] = "Created user_presence table";
    }

    // Migrate existing board owners to board_members
    $migrateStmt = $pdo->query("
        SELECT b.id as board_id, b.user_id
        FROM boards b
        LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.role = 'owner'
        WHERE bm.id IS NULL AND b.user_id IS NOT NULL
    ");
    $ownersToMigrate = $migrateStmt->fetchAll();
    $insertStmt = $pdo->prepare("
        INSERT INTO board_members (board_id, user_id, role, invited_by, accepted_at, created_at)
        VALUES (?, ?, 'owner', NULL, NOW(), NOW())
    ");
    $migratedCount = 0;
    foreach ($ownersToMigrate as $owner) {
        $insertStmt->execute([$owner['board_id'], $owner['user_id']]);
        $migratedCount++;
    }
    if ($migratedCount > 0) {
        $success[] = "Migrated $migratedCount existing board owners to board_members";
    }

    // Create board_events table for real-time updates
    $eventsTableStmt = $pdo->query("SHOW TABLES LIKE 'board_events'");
    if ($eventsTableStmt->rowCount() === 0) {
        $pdo->exec("
            CREATE TABLE board_events (
                id INT AUTO_INCREMENT PRIMARY KEY,
                board_id INT NOT NULL,
                user_id INT NOT NULL,
                event_type VARCHAR(50) NOT NULL,
                event_data JSON NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_board_id (board_id),
                INDEX idx_created_at (created_at),
                INDEX idx_user_id (user_id)
            )
        ");
        $success[] = "Created board_events table for real-time updates";
    }

    // ===== END COLLABORATION TABLES =====

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
