<?php
/**
 * WebSocket Server for Kanban Real-time Collaboration
 *
 * Run with: php websocket-server.php
 * Or via Docker container
 */

require_once '/var/www/html/api/db.php';

// Simple WebSocket server implementation
class KanbanWebSocketServer {
    private $host;
    private $port;
    private $socket;
    private $clients = [];
    private $pdo;

    public function __construct($host = '0.0.0.0', $port = 8080) {
        $this->host = $host;
        $this->port = $port;
        global $pdo;
        $this->pdo = $pdo;
    }

    public function start() {
        // Create socket
        $this->socket = socket_create(AF_INET, SOCK_STREAM, SOL_TCP);
        socket_set_option($this->socket, SOL_SOCKET, SO_REUSEADDR, 1);
        socket_bind($this->socket, $this->host, $this->port);
        socket_listen($this->socket);

        echo "WebSocket Server started on {$this->host}:{$this->port}\n";
        echo "Waiting for connections...\n\n";

        // Add server socket to clients list
        $this->clients[] = [
            'socket' => $this->socket,
            'type' => 'server',
            'id' => 'server'
        ];

        $lastPingTime = time();

        while (true) {
            $changed = [];
            foreach ($this->clients as $client) {
                $changed[] = $client['socket'];
            }

            // Wait for activity (with 5 second timeout for ping)
            $write = null;
            $except = null;
            $timeout = 5; // 5 seconds to allow periodic pings
            $selectResult = @socket_select($changed, $write, $except, $timeout);

            if ($selectResult === false) {
                // Interrupted by signal, continue loop
                continue;
            }

            // Send periodic pings to keep connections alive
            $now = time();
            if ($now - $lastPingTime >= 30) { // Ping every 30 seconds
                $this->sendPingToAll();
                $lastPingTime = $now;
            }

            foreach ($changed as $changedSocket) {
                if ($changedSocket === $this->socket) {
                    // New connection
                    $newSocket = socket_accept($this->socket);
                    $this->handleNewConnection($newSocket);
                } else {
                    // Data from existing client
                    $client = $this->findClientBySocket($changedSocket);
                    if ($client) {
                        $data = @socket_read($changedSocket, 8192);
                        if ($data === false) {
                            $error = socket_last_error($changedSocket);
                            echo "Socket read error for {$client['id']}: " . socket_strerror($error) . " ($error)\n";
                            $this->disconnectClient($client);
                        } elseif (strlen($data) === 0) {
                            echo "Client {$client['id']} closed connection (empty read)\n";
                            $this->disconnectClient($client);
                        } else {
                            $this->handleData($client, $data);
                        }
                    }
                }
            }
        }
    }

    private function handleNewConnection($socket) {
        // WebSocket handshake will happen here
        $clientId = uniqid('client_', true);
        $this->clients[] = [
            'socket' => $socket,
            'type' => 'pending',
            'id' => $clientId,
            'handshake' => false,
            'user_id' => null,
            'board_id' => null,
            'username' => null
        ];

        echo "New connection: {$clientId}\n";
    }

    private function handleData($client, $data) {
        if (!$client['handshake']) {
            // Perform WebSocket handshake
            $this->performHandshake($client, $data);
            return;
        }

        // Decode WebSocket frame
        $decoded = $this->decodeWebSocketFrame($data);
        if ($decoded === null) {
            echo "Invalid or incomplete frame received from {$client['id']}\n";
            return; // Invalid frame
        }

        if ($decoded['opcode'] === 0x08) {
            // Close frame
            echo "Close frame received from {$client['id']}\n";
            $this->disconnectClient($client);
            return;
        }

        if ($decoded['opcode'] === 0x09) {
            // Ping - send pong
            echo "Ping received from {$client['id']}\n";
            $this->sendWebSocketFrame($client['socket'], '', 0x0A);
            return;
        }

        if ($decoded['opcode'] === 0x0A) {
            // Pong - connection is alive, no action needed
            return;
        }

        // Process message
        $message = $decoded['payload'];
        echo "Received message from {$client['id']}: " . substr($message, 0, 100) . "\n";
        $this->processMessage($client, $message);
    }

    private function performHandshake($client, $data) {
        $headers = $this->parseHeaders($data);

        if (!isset($headers['Sec-WebSocket-Key'])) {
            $this->disconnectClient($client);
            return;
        }

        $key = $headers['Sec-WebSocket-Key'];
        $accept = base64_encode(sha1($key . '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', true));

        $response = "HTTP/1.1 101 Switching Protocols\r\n";
        $response .= "Upgrade: websocket\r\n";
        $response .= "Connection: Upgrade\r\n";
        $response .= "Sec-WebSocket-Accept: {$accept}\r\n";
        $response .= "\r\n";

        socket_write($client['socket'], $response, strlen($response));

        // Update client status
        $clientIndex = $this->findClientIndex($client['id']);
        if ($clientIndex !== null) {
            $this->clients[$clientIndex]['handshake'] = true;
        }

        echo "Handshake completed for {$client['id']}\n";
    }

    private function parseHeaders($data) {
        $headers = [];
        $lines = explode("\r\n", $data);

        foreach ($lines as $line) {
            if (strpos($line, ':') !== false) {
                list($key, $value) = explode(':', $line, 2);
                $headers[trim($key)] = trim($value);
            }
        }

        // Parse query string from GET line
        $firstLine = $lines[0] ?? '';
        if (preg_match('/GET\s+\/\?(.+)\s+HTTP/', $firstLine, $matches)) {
            parse_str($matches[1], $queryParams);
            $headers = array_merge($headers, $queryParams);
        }

        return $headers;
    }

    private function decodeWebSocketFrame($data) {
        if (strlen($data) < 2) return null;

        $byte1 = ord($data[0]);
        $byte2 = ord($data[1]);

        $opcode = $byte1 & 15;
        $isMasked = ($byte2 & 0x80) !== 0;
        $length = $byte2 & 0x7F;

        $offset = 2;

        if ($length === 126) {
            if (strlen($data) < 4) return null;
            $length = unpack('n', substr($data, 2, 2))[1];
            $offset = 4;
        } elseif ($length === 127) {
            if (strlen($data) < 10) return null;
            $length = unpack('J', substr($data, 2, 8))[1];
            $offset = 10;
        }

        $payload = '';
        if ($isMasked) {
            if (strlen($data) < $offset + 4 + $length) return null;
            $mask = substr($data, $offset, 4);
            $offset += 4;
            $payload = substr($data, $offset, $length);
            // Unmask
            $decoded = '';
            for ($i = 0; $i < strlen($payload); $i++) {
                $decoded .= $payload[$i] ^ $mask[$i % 4];
            }
            $payload = $decoded;
        } else {
            if (strlen($data) < $offset + $length) return null;
            $payload = substr($data, $offset, $length);
        }

        return [
            'opcode' => $opcode,
            'payload' => $payload
        ];
    }

    private function sendWebSocketFrame($socket, $payload, $opcode = 0x01) {
        $length = strlen($payload);

        // Server-to-client frames must NOT be masked (mask bit = 0)
        // FIN=1, opcode=text(0x01): first byte = 0x81
        // MASK=0, length: second byte = length
        if ($length <= 125) {
            $header = chr(0x80 | $opcode) . chr($length);
        } elseif ($length <= 65535) {
            $header = chr(0x80 | $opcode) . chr(126) . pack('n', $length);
        } else {
            $header = chr(0x80 | $opcode) . chr(127) . pack('NN', 0, $length);
        }

        // No masking for server-to-client frames (per WebSocket RFC 6455)
        $frame = $header . $payload;
        $bytesWritten = @socket_write($socket, $frame, strlen($frame));
        if ($bytesWritten === false) {
            echo "Failed to write to socket: " . socket_strerror(socket_last_error($socket)) . "\n";
        }
    }

    private function processMessage($client, $message) {
        $data = json_decode($message, true);
        if (!$data) return;

        $type = $data['type'] ?? 'unknown';

        // Get fresh client data (since auth may have updated it)
        $freshClient = $this->getClientById($client['id']);
        if (!$freshClient) return;

        switch ($type) {
            case 'auth':
                $this->handleAuth($freshClient, $data);
                break;

            case 'join_board':
                echo "Processing join_board for client {$client['id']}\n";
                $this->handleJoinBoard($freshClient, $data);
                break;

            case 'leave_board':
                $this->handleLeaveBoard($freshClient);
                break;

            case 'task_update':
            case 'task_create':
            case 'task_delete':
            case 'task_move':
                $this->handleTaskEvent($freshClient, $data);
                break;

            case 'column_update':
            case 'column_create':
            case 'column_delete':
            case 'column_move':
            case 'column_moved':
                $this->handleColumnEvent($freshClient, $data);
                break;

            case 'cursor_position':
                $this->handleCursorPosition($freshClient, $data);
                break;

            case 'ping':
                $this->sendToClient($freshClient, ['type' => 'pong', 'time' => time()]);
                break;

            case 'admin_broadcast':
                $this->handleAdminBroadcast($freshClient, $data);
                break;
        }
    }

    private function handleAuth($client, $data) {
        $sessionId = $data['session_id'] ?? null;
        $userId = $data['user_id'] ?? null;

        if (!$userId) {
            $this->sendToClient($client, ['type' => 'auth_error', 'message' => 'Missing user_id']);
            return;
        }

        // Verify user exists
        $stmt = $this->pdo->prepare("SELECT id, username FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $user = $stmt->fetch();

        if (!$user) {
            $this->sendToClient($client, ['type' => 'auth_error', 'message' => 'Invalid user']);
            return;
        }

        // Update client in the clients array
        $clientIndex = $this->findClientIndex($client['id']);
        if ($clientIndex !== null) {
            $this->clients[$clientIndex]['user_id'] = $userId;
            $this->clients[$clientIndex]['username'] = $user['username'];
            $this->clients[$clientIndex]['type'] = 'authenticated';
        }

        $this->sendToClient($client, [
            'type' => 'auth_success',
            'user_id' => $userId,
            'username' => $user['username']
        ]);

        echo "Client {$client['id']} authenticated as {$user['username']}\n";
    }

    /**
     * Get fresh client data from the clients array
     */
    private function getClientById($clientId) {
        foreach ($this->clients as $client) {
            if ($client['id'] === $clientId) {
                return $client;
            }
        }
        return null;
    }

    private function handleJoinBoard($client, $data) {
        $boardId = $data['board_id'] ?? null;

        echo "handleJoinBoard: client_id={$client['id']}, user_id=" . ($client['user_id'] ?? 'null') . ", boardId=" . ($boardId ?? 'null') . "\n";

        if (!$boardId || !$client['user_id']) {
            $this->sendToClient($client, ['type' => 'error', 'message' => 'Not authenticated or missing board_id']);
            echo "handleJoinBoard: FAILED - missing boardId or user_id\n";
            return;
        }

        // Verify board access
        $stmt = $this->pdo->prepare("
            SELECT b.id, b.name FROM boards b
            LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = ?
            WHERE b.id = ? AND (b.user_id = ? OR bm.user_id = ?)
        ");
        $stmt->execute([$client['user_id'], $boardId, $client['user_id'], $client['user_id']]);
        $board = $stmt->fetch();

        if (!$board) {
            $this->sendToClient($client, ['type' => 'error', 'message' => 'Board not found or access denied']);
            return;
        }

        // Update client
        $clientIndex = $this->findClientIndex($client['id']);
        if ($clientIndex !== null) {
            $this->clients[$clientIndex]['board_id'] = $boardId;
        }

        // Notify client
        $this->sendToClient($client, [
            'type' => 'joined_board',
            'board_id' => $boardId,
            'board_name' => $board['name']
        ]);

        // Broadcast to other clients on same board
        $this->broadcastToBoard($boardId, [
            'type' => 'user_joined',
            'user_id' => $client['user_id'],
            'username' => $client['username']
        ], $client['id']);

        // Send current users on this board
        $usersOnBoard = [];
        foreach ($this->clients as $c) {
            if ($c['board_id'] == $boardId && $c['id'] !== $client['id'] && $c['user_id']) {
                $usersOnBoard[] = [
                    'user_id' => $c['user_id'],
                    'username' => $c['username']
                ];
            }
        }

        $this->sendToClient($client, [
            'type' => 'board_users',
            'users' => $usersOnBoard
        ]);

        echo "Client {$client['id']} ({$client['username']}) joined board {$boardId}\n";
    }

    private function handleLeaveBoard($client) {
        if (!$client['board_id']) return;

        $boardId = $client['board_id'];

        // Update client
        $clientIndex = $this->findClientIndex($client['id']);
        if ($clientIndex !== null) {
            $this->clients[$clientIndex]['board_id'] = null;
        }

        // Broadcast to other clients
        $this->broadcastToBoard($boardId, [
            'type' => 'user_left',
            'user_id' => $client['user_id'],
            'username' => $client['username']
        ], $client['id']);

        echo "Client {$client['id']} left board {$boardId}\n";
    }

    private function handleTaskEvent($client, $data) {
        if (!$client['board_id']) {
            echo "handleTaskEvent: client {$client['id']} has no board_id set\n";
            return;
        }

        echo "handleTaskEvent: broadcasting {$data['type']} from {$client['username']} to board {$client['board_id']}\n";

        // Broadcast to all other clients on the same board
        $this->broadcastToBoard($client['board_id'], [
            'type' => $data['type'],
            'data' => $data['data'] ?? [],
            'user_id' => $client['user_id'],
            'username' => $client['username']
        ], $client['id']);
    }

    private function handleColumnEvent($client, $data) {
        if (!$client['board_id']) {
            echo "handleColumnEvent: client {$client['id']} has no board_id set\n";
            return;
        }

        echo "handleColumnEvent: broadcasting {$data['type']} from {$client['username']} to board {$client['board_id']}\n";

        // Broadcast to all other clients on the same board
        $this->broadcastToBoard($client['board_id'], [
            'type' => $data['type'],
            'data' => $data['data'] ?? [],
            'user_id' => $client['user_id'],
            'username' => $client['username']
        ], $client['id']);
    }

    private function handleCursorPosition($client, $data) {
        if (!$client['board_id']) return;

        // Broadcast cursor position to other clients (throttled)
        $this->broadcastToBoard($client['board_id'], [
            'type' => 'cursor_update',
            'user_id' => $client['user_id'],
            'username' => $client['username'],
            'x' => $data['x'] ?? 0,
            'y' => $data['y'] ?? 0,
            'task_id' => $data['task_id'] ?? null
        ], $client['id']);
    }

    private function handleAdminBroadcast($client, $data) {
        $secret = $data['secret'] ?? null;
        $targetType = $data['target_type'] ?? null; // 'user' or 'board'
        $targetId = $data['target_id'] ?? null;
        $message = $data['message'] ?? null;

        // Simple secret check (should match an environment variable in production)
        if ($secret !== 'kanban_admin_secret') {
            $this->sendToClient($client, ['type' => 'error', 'message' => 'Invalid secret']);
            return;
        }

        if (!$targetType || !$targetId || !$message) {
            $this->sendToClient($client, ['type' => 'error', 'message' => 'Missing parameters']);
            return;
        }

        if ($targetType === 'user') {
            $this->broadcastToUser($targetId, $message);
            $this->sendToClient($client, ['type' => 'success', 'message' => 'Broadcast sent to user']);
        } elseif ($targetType === 'board') {
            $this->broadcastToBoard($targetId, $message);
            $this->sendToClient($client, ['type' => 'success', 'message' => 'Broadcast sent to board']);
        }
    }

    private function broadcastToBoard($boardId, $message, $excludeClientId = null) {
        $sentCount = 0;
        foreach ($this->clients as $client) {
            if ($client['type'] === 'authenticated' &&
                $client['board_id'] == $boardId &&
                $client['id'] !== $excludeClientId) {
                $this->sendToClient($client, $message);
                $sentCount++;
            }
        }
        if ($sentCount > 0) {
            echo "Broadcasted {$message['type']} to $sentCount clients on board $boardId\n";
        }
    }

    private function broadcastToUser($userId, $message) {
        foreach ($this->clients as $client) {
            if ($client['type'] === 'authenticated' &&
                $client['user_id'] == $userId) {
                $this->sendToClient($client, $message);
            }
        }
    }

    private function sendToClient($client, $message) {
        $json = json_encode($message);
        $this->sendWebSocketFrame($client['socket'], $json);
    }

    private function sendPingToAll() {
        foreach ($this->clients as $client) {
            if ($client['type'] === 'authenticated' && $client['handshake']) {
                // Send WebSocket ping frame (opcode 0x09)
                $this->sendWebSocketFrame($client['socket'], '', 0x09);
            }
        }
    }

    private function disconnectClient($client) {
        // If client was on a board, notify others
        if ($client['board_id'] && $client['user_id']) {
            $this->broadcastToBoard($client['board_id'], [
                'type' => 'user_left',
                'user_id' => $client['user_id'],
                'username' => $client['username']
            ], $client['id']);
        }

        // Close socket
        @socket_close($client['socket']);

        // Remove from clients list
        $index = $this->findClientIndex($client['id']);
        if ($index !== null) {
            array_splice($this->clients, $index, 1);
        }

        echo "Client {$client['id']} disconnected\n";
    }

    private function findClientBySocket($socket) {
        foreach ($this->clients as $client) {
            if ($client['socket'] === $socket) {
                return $client;
            }
        }
        return null;
    }

    private function findClientIndex($clientId) {
        foreach ($this->clients as $index => $client) {
            if ($client['id'] === $clientId) {
                return $index;
            }
        }
        return null;
    }
}

// Start server
$server = new KanbanWebSocketServer('0.0.0.0', 8080);
$server->start();
