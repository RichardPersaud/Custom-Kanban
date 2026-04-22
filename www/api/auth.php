<?php
/**
 * Authentication API Endpoint
 *
 * POST /api/auth/register - Register new user
 * POST /api/auth/login    - Login user
 * POST /api/auth/logout   - Logout user
 * GET  /api/auth/me       - Get current user
 * POST /api/auth/google   - Google OAuth login
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/config/google-oauth.php';

$method = $_SERVER['REQUEST_METHOD'];
$segments = getPathSegments();
$action = isset($segments[2]) ? $segments[2] : '';

try {
    switch ($action) {
        case 'register':
            handleRegister();
            break;
        case 'login':
            handleLogin();
            break;
        case 'logout':
            handleLogout();
            break;
        case 'me':
            handleGetCurrentUser();
            break;
        case 'profile':
            handleUpdateProfile();
            break;
        case 'google':
            handleGoogleAuth();
            break;
        default:
            jsonError('Invalid action', 400);
    }
} catch (Exception $e) {
    logError('Auth error: ' . $e->getMessage());
    jsonError('Authentication failed', 500);
}

/**
 * Handle user registration
 */
function handleRegister() {
    global $pdo;

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        jsonError('Method not allowed', 405);
    }

    $input = getJsonInput();
    if ($input === null) {
        jsonError('Invalid JSON input', 400);
    }

    // Validate required fields
    if (empty($input['username']) || empty($input['email']) || empty($input['password'])) {
        jsonError('Username, email, and password are required', 400);
    }

    $username = trim($input['username']);
    $email = trim($input['email']);
    $password = $input['password'];

    // Validate username
    if (!preg_match('/^[a-zA-Z0-9_]{3,50}$/', $username)) {
        jsonError('Username must be 3-50 characters and contain only letters, numbers, and underscores', 400);
    }

    // Validate email
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        jsonError('Invalid email address', 400);
    }

    // Validate password
    if (strlen($password) < 8) {
        jsonError('Password must be at least 8 characters', 400);
    }

    // Check if username exists
    $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ?");
    $stmt->execute([$username]);
    if ($stmt->fetch()) {
        jsonError('Username already taken', 409);
    }

    // Check if email exists
    $stmt = $pdo->prepare("SELECT id FROM users WHERE email = ?");
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        jsonError('Email already registered', 409);
    }

    // Hash password
    $passwordHash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);

    // Create user
    $stmt = $pdo->prepare("INSERT INTO users (username, email, password, created_at) VALUES (?, ?, ?, NOW())");
    $stmt->execute([$username, $email, $passwordHash]);

    $userId = $pdo->lastInsertId();

    // Set session
    $_SESSION['user_id'] = $userId;
    $_SESSION['username'] = $username;
    $_SESSION['email'] = $email;

    // Create default board for new user
    createDefaultBoard($userId);

    logDebug("User registered: $username (ID: $userId)");

    jsonResponse([
        'success' => true,
        'data' => [
            'id' => $userId,
            'username' => $username,
            'email' => $email
        ]
    ]);
}

/**
 * Handle user login
 */
function handleLogin() {
    global $pdo;

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        jsonError('Method not allowed', 405);
    }

    $input = getJsonInput();
    if ($input === null) {
        jsonError('Invalid JSON input', 400);
    }

    $email = trim($input['email'] ?? '');
    $password = $input['password'] ?? '';

    if (empty($email) || empty($password)) {
        jsonError('Email and password are required', 400);
    }

    // Find user by email
    $stmt = $pdo->prepare("SELECT id, username, email, password FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password'])) {
        jsonError('Invalid email or password', 401);
    }

    // Set session
    $_SESSION['user_id'] = $user['id'];
    $_SESSION['username'] = $user['username'];
    $_SESSION['email'] = $user['email'];

    logDebug("User logged in: {$user['username']} (ID: {$user['id']})");

    jsonResponse([
        'success' => true,
        'data' => [
            'id' => $user['id'],
            'username' => $user['username'],
            'email' => $user['email']
        ]
    ]);
}

/**
 * Handle logout
 */
function handleLogout() {
    // Clear session
    $_SESSION = [];

    // Destroy session cookie
    if (isset($_COOKIE[session_name()])) {
        setcookie(session_name(), '', [
            'expires' => time() - 3600,
            'path' => '/',
            'secure' => false,  // Allow non-HTTPS for local development
            'httponly' => true,
            'samesite' => 'Lax'  // Changed from Strict for compatibility
        ]);
    }

    session_destroy();

    logDebug("User logged out");

    // Return 204 No Content for beacon requests (no body needed)
    http_response_code(204);
    exit;
}

/**
 * Get current authenticated user
 */
function handleGetCurrentUser() {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        jsonError('Method not allowed', 405);
    }

    if (!isset($_SESSION['user_id'])) {
        jsonError('Not authenticated', 401);
    }

    jsonResponse([
        'success' => true,
        'data' => [
            'id' => $_SESSION['user_id'],
            'username' => $_SESSION['username'],
            'email' => $_SESSION['email']
        ]
    ]);
}

/**
 * Handle Google OAuth
 */
function handleGoogleAuth() {
    global $pdo;

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        jsonError('Method not allowed', 405);
    }

    $input = getJsonInput();
    if ($input === null || empty($input['credential'])) {
        jsonError('Google credential is required', 400);
    }

    $credential = $input['credential'];

    // Verify Google ID token
    $googleData = verifyGoogleToken($credential);

    if (!$googleData) {
        jsonError('Invalid Google token', 401);
    }

    $googleId = $googleData['sub'];
    $email = $googleData['email'];
    $username = sanitizeUsername($googleData['name'] ?? '');
    $picture = $googleData['picture'] ?? null;

    // Check if user exists by google_id first
    $stmt = $pdo->prepare("SELECT id, username, email FROM users WHERE google_id = ?");
    $stmt->execute([$googleId]);
    $user = $stmt->fetch();

    if (!$user) {
        // Check if user exists by email
        $stmt = $pdo->prepare("SELECT id, username, email FROM users WHERE email = ?");
        $stmt->execute([$email]);
        $user = $stmt->fetch();

        if ($user) {
            // Existing user - update google_id
            $stmt = $pdo->prepare("UPDATE users SET google_id = ? WHERE id = ?");
            $stmt->execute([$googleId, $user['id']]);
            $userId = $user['id'];
            $username = $user['username'];
            logDebug("Linked Google account to existing user: $username (ID: $userId)");
        } else {
            // New user - create account
            // Generate unique username if needed
            $baseUsername = $username;
            $counter = 1;
            while (true) {
                $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ?");
                $stmt->execute([$username]);
                if (!$stmt->fetch()) break;
                $username = $baseUsername . $counter;
                $counter++;
            }

            // Create user with random password (they'll use Google to log in)
            $randomPassword = bin2hex(random_bytes(32));
            $passwordHash = password_hash($randomPassword, PASSWORD_BCRYPT);

            $stmt = $pdo->prepare("INSERT INTO users (username, email, password, google_id, created_at) VALUES (?, ?, ?, ?, NOW())");
            $stmt->execute([$username, $email, $passwordHash, $googleId]);

            $userId = $pdo->lastInsertId();

            // Create default board
            createDefaultBoard($userId);

            logDebug("User registered via Google: $username (ID: $userId)");
        }
    } else {
        // Existing user by google_id - log them in
        $userId = $user['id'];
        $username = $user['username'];
    }

    // Set session
    $_SESSION['user_id'] = $userId;
    $_SESSION['username'] = $username;
    $_SESSION['email'] = $email;

    jsonResponse([
        'success' => true,
        'data' => [
            'id' => $userId,
            'username' => $username,
            'email' => $email,
            'picture' => $picture
        ]
    ]);
}

/**
 * Update user profile (display name and bio)
 */
function handleUpdateProfile() {
    global $pdo;

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        jsonError('Method not allowed', 405);
    }

    if (!isset($_SESSION['user_id'])) {
        jsonError('Not authenticated', 401);
    }

    $input = getJsonInput();
    if ($input === null) {
        jsonError('Invalid JSON input', 400);
    }

    $displayName = isset($input['display_name']) ? trim($input['display_name']) : '';
    $bio = isset($input['bio']) ? trim($input['bio']) : '';

    // Validate display name
    if (empty($displayName)) {
        jsonError('Display name is required', 400);
    }

    if (!preg_match('/^[a-zA-Z0-9_\s]{3,50}$/', $displayName)) {
        jsonError('Display name must be 3-50 characters and contain only letters, numbers, spaces, and underscores', 400);
    }

    $userId = $_SESSION['user_id'];

    // Check if username is already taken by another user
    $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ? AND id != ?");
    $stmt->execute([$displayName, $userId]);
    if ($stmt->fetch()) {
        jsonError('Display name already taken', 409);
    }

    // Update user profile
    $stmt = $pdo->prepare("UPDATE users SET username = ? WHERE id = ?");
    $stmt->execute([$displayName, $userId]);

    // Update session
    $_SESSION['username'] = $displayName;

    logDebug("Profile updated for user ID: $userId, new username: $displayName");

    jsonResponse([
        'success' => true,
        'data' => [
            'id' => $userId,
            'username' => $displayName,
            'email' => $_SESSION['email']
        ]
    ]);
}

/**
 * Verify Google ID token
 */
function verifyGoogleToken($credential) {
    // Google's token verification endpoint
    $url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($credential);

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        logError("Google token verification failed: HTTP $httpCode");
        return false;
    }

    $data = json_decode($response, true);

    if (!$data || !isset($data['sub'])) {
        logError("Invalid Google token response");
        return false;
    }

    // Verify the token is from our client (optional - add GOOGLE_CLIENT_ID check if needed)
    // $clientId = getenv('GOOGLE_CLIENT_ID') ?: 'your-google-client-id';
    // if ($data['aud'] !== $clientId) {
    //     logError("Google token audience mismatch");
    //     return false;
    // }

    return $data;
}

/**
 * Create default board for new user
 */
function createDefaultBoard($userId) {
    global $pdo;

    // Create default board
    $stmt = $pdo->prepare("INSERT INTO boards (name, user_id, created_at) VALUES (?, ?, NOW())");
    $stmt->execute(['My First Board', $userId]);
    $boardId = $pdo->lastInsertId();

    // Create default columns
    $defaultColumns = [
        ['To Do', 1, '#6b7280'],
        ['In Progress', 2, '#3b82f6'],
        ['Review', 3, '#eab308'],
        ['Done', 4, '#22c55e']
    ];

    $stmt = $pdo->prepare("INSERT INTO columns (name, position, color, user_id, board_id) VALUES (?, ?, ?, ?, ?)");
    foreach ($defaultColumns as $col) {
        $stmt->execute([$col[0], $col[1], $col[2], $userId, $boardId]);
    }

    logDebug("Created default board for user $userId");
}

/**
 * Sanitize username from Google name
 */
function sanitizeUsername($name) {
    // Convert to lowercase, replace spaces with underscores, remove special chars
    $username = strtolower(trim($name));
    $username = preg_replace('/\s+/', '_', $username);
    $username = preg_replace('/[^a-z0-9_]/', '', $username);

    // Ensure minimum length
    if (strlen($username) < 3) {
        $username = 'user_' . substr(md5($name . time()), 0, 8);
    }

    // Limit to 50 chars
    return substr($username, 0, 50);
}
