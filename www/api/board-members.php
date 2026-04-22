<?php
/**
 * Board Members API Endpoint
 *
 * GET    /api/boards/{id}/members          - List all members of a board
 * POST   /api/boards/{id}/invite           - Send invitation
 * POST   /api/boards/{id}/accept           - Accept invitation (via token)
 * PUT    /api/boards/{id}/members/{user_id} - Update member role
 * DELETE /api/boards/{id}/members/{user_id} - Remove member
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/config/email-config.php';

$method = $_SERVER['REQUEST_METHOD'];
$segments = getPathSegments();
$boardId = isset($segments[2]) ? (int)$segments[2] : null;
$action = isset($segments[3]) ? $segments[3] : null;

// Public endpoint: GET /api/boards/{id}/invite-info?token=xxx
// Returns board info without requiring membership (for invitation acceptance page)
// This must come BEFORE the auth check
if ($method === 'GET' && $action === 'invite-info' && $boardId) {
    $token = isset($_GET['token']) ? $_GET['token'] : null;
    if (!$token) {
        jsonError('Token is required', 400);
    }
    // This is a public endpoint - no auth required
    getBoardByInvitationToken($token, $boardId);
    exit;
}

// Require authentication for all other operations
if (!$userId) {
    jsonError('Unauthorized', 401);
}

try {

    switch ($method) {
        case 'GET':
            // GET /api/boards/{id}/members
            if (!$boardId) {
                jsonError('Board ID is required', 400);
            }

            // Check if user has access to this board
            if (!hasBoardAccess($boardId, $userId)) {
                jsonError('Board not found', 404);
            }

            // Get all members with user details
            $stmt = $pdo->prepare("
                SELECT bm.*, u.username, u.email
                FROM board_members bm
                JOIN users u ON bm.user_id = u.id
                WHERE bm.board_id = ?
                ORDER BY FIELD(bm.role, 'owner', 'admin', 'member'), u.username
            ");
            $stmt->execute([$boardId]);
            $members = $stmt->fetchAll();

            // Get pending invitations
            $stmt = $pdo->prepare("
                SELECT bi.*, u.username as invited_by_name
                FROM board_invitations bi
                LEFT JOIN users u ON bi.invited_by = u.id
                WHERE bi.board_id = ? AND bi.accepted_by IS NULL AND bi.expires_at > NOW()
            ");
            $stmt->execute([$boardId]);
            $pendingInvitations = $stmt->fetchAll();

            jsonResponse([
                'success' => true,
                'data' => [
                    'members' => $members,
                    'pending_invitations' => $pendingInvitations
                ]
            ]);
            break;

        case 'POST':
            if ($action === 'accept') {
                // POST /api/boards/{id}/accept
                handleAcceptInvitation($boardId, $userId);
            } else {
                // POST /api/boards/{id}/invite
                handleSendInvitation($boardId, $userId);
            }
            break;

        case 'PUT':
        case 'PATCH':
            // PUT /api/boards/{id}/members/{user_id}
            if (!$boardId) {
                jsonError('Board ID is required', 400);
            }
            $targetUserId = isset($segments[4]) ? (int)$segments[4] : null;
            if (!$targetUserId) {
                jsonError('User ID is required', 400);
            }

            // Only owners and admins can update roles
            $userRole = getUserBoardRole($boardId, $userId);
            if (!in_array($userRole, ['owner', 'admin'])) {
                jsonError('Permission denied', 403);
            }

            // Owners cannot have their role changed by admins
            $targetRole = getUserBoardRole($boardId, $targetUserId);
            if ($targetRole === 'owner' && $userRole !== 'owner') {
                jsonError('Cannot modify owner role', 403);
            }

            $input = getJsonInput();
            $newRole = $input['role'] ?? null;
            if (!in_array($newRole, ['admin', 'member'])) {
                jsonError('Invalid role. Must be admin or member', 400);
            }

            $stmt = $pdo->prepare("
                UPDATE board_members
                SET role = ?
                WHERE board_id = ? AND user_id = ?
            ");
            $stmt->execute([$newRole, $boardId, $targetUserId]);

            jsonResponse(['success' => true, 'message' => 'Role updated']);
            break;

        case 'DELETE':
            // Check if this is a DELETE for an invitation or a member
            if ($action === 'invitation' || $action === 'invitations') {
                // DELETE /api/boards/{id}/invitations/{invitation_id}
                handleRevokeInvitation($boardId, $userId);
            } else {
                // DELETE /api/boards/{id}/members/{user_id}
                if (!$boardId) {
                    jsonError('Board ID is required', 400);
                }
                $targetUserId = isset($segments[4]) ? (int)$segments[4] : null;
                if (!$targetUserId) {
                    jsonError('User ID is required', 400);
                }

                // Users can remove themselves, owners can remove anyone
                $userRole = getUserBoardRole($boardId, $userId);
                if ($userId !== $targetUserId && $userRole !== 'owner') {
                    jsonError('Permission denied', 403);
                }

                // Cannot remove the last owner
                $stmt = $pdo->prepare("
                    SELECT COUNT(*) as owner_count
                    FROM board_members
                    WHERE board_id = ? AND role = 'owner'
                ");
                $stmt->execute([$boardId]);
                $ownerCount = $stmt->fetch()['owner_count'];

                $targetRole = getUserBoardRole($boardId, $targetUserId);
                if ($targetRole === 'owner' && $ownerCount <= 1) {
                    jsonError('Cannot remove the last owner', 400);
                }

                $stmt = $pdo->prepare("
                    DELETE FROM board_members
                    WHERE board_id = ? AND user_id = ?
                ");
                $stmt->execute([$boardId, $targetUserId]);

                // Notify the removed user via WebSocket
                notifyUserWebSocket($targetUserId, [
                    'type' => 'removed_from_board',
                    'board_id' => $boardId,
                    'message' => 'You have been removed from this board'
                ]);

                jsonResponse(['success' => true, 'message' => 'Member removed']);
            }
            break;

        default:
            jsonError('Method not allowed', 405);
    }
} catch (PDOException $e) {
    logError("Database error in board-members.php", ['error' => $e->getMessage()]);
    jsonError('Database error', 500, ['details' => $e->getMessage()]);
}

/**
 * Handle sending an invitation
 */
function handleSendInvitation($boardId, $userId) {
    global $pdo;

    if (!$boardId) {
        jsonError('Board ID is required', 400);
    }

    // Only owners and admins can invite
    $userRole = getUserBoardRole($boardId, $userId);
    if (!in_array($userRole, ['owner', 'admin'])) {
        jsonError('Permission denied', 403);
    }

    $input = getJsonInput();
    $email = isset($input['email']) ? trim($input['email']) : null;
    $role = isset($input['role']) ? $input['role'] : 'member';

    if (!in_array($role, ['admin', 'member'])) {
        jsonError('Invalid role. Must be admin or member', 400);
    }

    // Admins cannot invite other admins
    if ($userRole === 'admin' && $role === 'admin') {
        jsonError('Admins cannot invite other admins', 403);
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        jsonError('Invalid email address', 400);
    }

    // Check if user is already a member
    $stmt = $pdo->prepare("
        SELECT u.id, u.email
        FROM users u
        JOIN board_members bm ON u.id = bm.user_id
        WHERE bm.board_id = ? AND u.email = ?
    ");
    $stmt->execute([$boardId, $email]);
    if ($stmt->fetch()) {
        jsonError('User is already a member of this board', 409);
    }

    // Check for existing pending invitation
    $stmt = $pdo->prepare("
        SELECT id FROM board_invitations
        WHERE board_id = ? AND email = ? AND accepted_by IS NULL AND expires_at > NOW()
    ");
    $stmt->execute([$boardId, $email]);
    if ($stmt->fetch()) {
        jsonError('Invitation already pending for this email', 409);
    }

    // Generate invitation token
    $token = bin2hex(random_bytes(32));
    $expiresAt = date('Y-m-d H:i:s', strtotime('+7 days'));

    // Find invited user if registered
    $stmt = $pdo->prepare("SELECT id FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $invitedUser = $stmt->fetch();

    $stmt = $pdo->prepare("
        INSERT INTO board_invitations
        (board_id, email, role, invited_by, token, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([$boardId, $email, $role, $userId, $token, $expiresAt]);

    // Get board name for email
    $stmt = $pdo->prepare("SELECT name FROM boards WHERE id = ?");
    $stmt->execute([$boardId]);
    $board = $stmt->fetch();

    // Get inviter name
    $stmt = $pdo->prepare("SELECT username FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $inviter = $stmt->fetch();

    // Send email
    $emailSent = sendInvitationEmail($email, $board['name'], $token, $boardId, $inviter['username'] ?? 'Someone');

    logDebug("Invitation created for $email on board $boardId. Email sent: " . ($emailSent ? 'YES' : 'NO'));

    jsonResponse([
        'success' => true,
        'message' => $emailSent ? 'Invitation sent' : 'Invitation created but email failed',
        'email_sent' => $emailSent,
        'data' => [
            'email' => $email,
            'role' => $role,
            'token' => $token
        ]
    ], 201);
}

/**
 * Get board info by invitation token (public endpoint - no auth required for board name)
 * Used to show board name before accepting invitation
 */
function getBoardByInvitationToken($token, $boardId) {
    global $pdo;

    logDebug("getBoardByInvitationToken called with token: " . substr($token, 0, 20) . "..., boardId: $boardId");

    try {
        // Verify the token is valid
        $stmt = $pdo->prepare("
            SELECT bi.*, b.name as board_name
            FROM board_invitations bi
            JOIN boards b ON bi.board_id = b.id
            WHERE bi.token = ? AND bi.board_id = ?
            AND bi.accepted_by IS NULL AND bi.expires_at > NOW()
        ");
        $stmt->execute([$token, $boardId]);
        $invitation = $stmt->fetch();

        logDebug("Query executed, found invitation: " . ($invitation ? 'yes' : 'no'));

        if (!$invitation) {
            jsonError('Invalid or expired invitation', 404);
        }

        jsonResponse([
            'success' => true,
            'data' => [
                'board_id' => (int)$boardId,
                'board_name' => $invitation['board_name'],
                'role' => $invitation['role'],
                'email' => $invitation['email']
            ]
        ]);
    } catch (Exception $e) {
        logError("Error in getBoardByInvitationToken", ['error' => $e->getMessage()]);
        jsonError('Server error', 500);
    }
}

/**
 * Handle accepting an invitation
 */
function handleAcceptInvitation($boardId, $userId) {
    global $pdo;

    $input = getJsonInput();
    $token = isset($input['token']) ? $input['token'] : null;

    if (!$token) {
        jsonError('Invitation token is required', 400);
    }

    // Find the invitation
    $stmt = $pdo->prepare("
        SELECT * FROM board_invitations
        WHERE token = ? AND board_id = ? AND accepted_by IS NULL AND expires_at > NOW()
    ");
    $stmt->execute([$token, $boardId]);
    $invitation = $stmt->fetch();

    if (!$invitation) {
        jsonError('Invalid or expired invitation', 404);
    }

    // Check if user email matches invitation
    $stmt = $pdo->prepare("SELECT email FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $user = $stmt->fetch();

    if (strtolower($user['email']) !== strtolower($invitation['email'])) {
        jsonError('This invitation is for a different email address', 403);
    }

    // Check if already a member
    $stmt = $pdo->prepare("
        SELECT id FROM board_members WHERE board_id = ? AND user_id = ?
    ");
    $stmt->execute([$boardId, $userId]);
    if ($stmt->fetch()) {
        jsonError('Already a member of this board', 409);
    }

    try {
        $pdo->beginTransaction();

        // Add to board_members
        $stmt = $pdo->prepare("
            INSERT INTO board_members
            (board_id, user_id, role, invited_by, accepted_at)
            VALUES (?, ?, ?, ?, NOW())
        ");
        $stmt->execute([$boardId, $userId, $invitation['role'], $invitation['invited_by']]);

        // Mark invitation as accepted
        $stmt = $pdo->prepare("
            UPDATE board_invitations
            SET accepted_by = ?, accepted_at = NOW()
            WHERE id = ?
        ");
        $stmt->execute([$userId, $invitation['id']]);

        $pdo->commit();

        jsonResponse([
            'success' => true,
            'message' => 'Invitation accepted',
            'data' => ['role' => $invitation['role']]
        ]);
    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }
}

/**
 * Get user's role on a board
 */
function getUserBoardRole($boardId, $userId) {
    global $pdo;

    $stmt = $pdo->prepare("
        SELECT role FROM board_members
        WHERE board_id = ? AND user_id = ?
    ");
    $stmt->execute([$boardId, $userId]);
    $result = $stmt->fetch();

    if ($result) {
        return $result['role'];
    }

    // Legacy check: board owner via boards table
    $stmt = $pdo->prepare("
        SELECT user_id FROM boards WHERE id = ? AND user_id = ?
    ");
    $stmt->execute([$boardId, $userId]);
    if ($stmt->fetch()) {
        return 'owner';
    }

    return null;
}

/**
 * Check if user has access to a board (owner, admin, member, or public)
 */
function hasBoardAccess($boardId, $userId) {
    global $pdo;

    // Check if member
    $stmt = $pdo->prepare("
        SELECT id FROM board_members
        WHERE board_id = ? AND user_id = ?
    ");
    $stmt->execute([$boardId, $userId]);
    if ($stmt->fetch()) {
        return true;
    }

    // Check if owner via boards table (legacy)
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

/**
 * Send invitation email
 */
function sendInvitationEmail($email, $boardName, $token, $boardId, $inviterName) {
    $acceptUrl = "http://{$_SERVER['HTTP_HOST']}/auth.html?invite_token={$token}&board_id={$boardId}";

    $subject = "You've been invited to collaborate on '{$boardName}'";

    $body = "<!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; }
            .header h1 { color: white; margin: 0; font-size: 24px; }
            .content { padding: 30px; }
            .button { display: inline-block; background: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #999; background: #f9fafb; }
        </style>
    </head>
    <body>
        <div class='container'>
            <div class='header'>
                <h1>KanbanFlow Invitation</h1>
            </div>
            <div class='content'>
                <p>Hello,</p>
                <p><strong>{$inviterName}</strong> has invited you to collaborate on the board <strong>\"{$boardName}\"</strong>.</p>
                <p>Click the button below to accept the invitation:</p>
                <p><a href='{$acceptUrl}' class='button' style='color: white;'>Accept Invitation</a></p>
                <p>Or copy and paste this link into your browser:</p>
                <p style='word-break: break-all; color: #666;'>{$acceptUrl}</p>
                <p>This invitation will expire in 7 days.</p>
            </div>
            <div class='footer'>
                <p>If you didn't expect this invitation, you can safely ignore this email.</p>
            </div>
        </div>
    </body>
    </html>";

    $result = sendEmail($email, $subject, $body);

    if ($result) {
        logDebug("Invitation email sent successfully to: $email");
    } else {
        logDebug("Failed to send invitation email to: $email (SMTP may not be configured)");
    }

    return $result;
}

/**
 * Handle revoking an invitation
 */
function handleRevokeInvitation($boardId, $userId) {
    global $pdo;

    if (!$boardId) {
        jsonError('Board ID is required', 400);
    }

    // Only owners and admins can revoke invitations
    $userRole = getUserBoardRole($boardId, $userId);
    if (!in_array($userRole, ['owner', 'admin'])) {
        jsonError('Permission denied', 403);
    }

    $segments = getPathSegments();
    $invitationId = isset($segments[4]) ? (int)$segments[4] : null;
    if (!$invitationId) {
        jsonError('Invitation ID is required', 400);
    }

    // Verify the invitation belongs to this board
    $stmt = $pdo->prepare("
        SELECT id, role FROM board_invitations
        WHERE id = ? AND board_id = ? AND accepted_by IS NULL AND expires_at > NOW()
    ");
    $stmt->execute([$invitationId, $boardId]);
    $invitation = $stmt->fetch();

    if (!$invitation) {
        jsonError('Invitation not found or already accepted/expired', 404);
    }

    // Admins cannot revoke admin invitations
    if ($userRole === 'admin' && $invitation['role'] === 'admin') {
        jsonError('Admins cannot revoke admin invitations', 403);
    }

    // Delete the invitation
    $stmt = $pdo->prepare("DELETE FROM board_invitations WHERE id = ?");
    $stmt->execute([$invitationId]);

    jsonResponse(['success' => true, 'message' => 'Invitation revoked']);
}
