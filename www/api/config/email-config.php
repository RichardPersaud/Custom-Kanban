<?php
/**
 * Email Configuration
 *
 * Configure SMTP settings via environment variables:
 * - SMTP_HOST: SMTP server hostname (default: smtp.gmail.com)
 * - SMTP_PORT: SMTP port (default: 587)
 * - SMTP_USER: SMTP username/email
 * - SMTP_PASS: SMTP password/app password
 * - SMTP_FROM: From email address
 * - SMTP_FROM_NAME: From name
 */

// Get SMTP configuration from environment
$smtpConfig = [
    'host' => getenv('SMTP_HOST') ?: '',
    'port' => (int)(getenv('SMTP_PORT') ?: 587),
    'username' => getenv('SMTP_USER') ?: '',
    'password' => getenv('SMTP_PASS') ?: '',
    'from_email' => getenv('SMTP_FROM') ?: getenv('SMTP_USER') ?: 'noreply@kanban.local',
    'from_name' => getenv('SMTP_FROM_NAME') ?: 'KanbanFlow',
    'secure' => getenv('SMTP_SECURE') ?: 'tls' // tls, ssl, or empty
];

/**
 * Check if SMTP is configured
 * @return bool
 */
function isSMTPConfigured() {
    global $smtpConfig;
    return !empty($smtpConfig['host']) && !empty($smtpConfig['username']) && !empty($smtpConfig['password']);
}

/**
 * Get SMTP configuration
 * @return array
 */
function getSMTPConfig() {
    global $smtpConfig;
    return $smtpConfig;
}

/**
 * Send email using SMTP
 *
 * @param string $to Recipient email
 * @param string $subject Email subject
 * @param string $body Email body (HTML)
 * @return bool Success
 */
function sendEmail($to, $subject, $body) {
    if (!isSMTPConfigured()) {
        logDebug("SMTP not configured - email would be sent to: $to");
        return false;
    }

    $config = getSMTPConfig();

    // Build email headers
    $boundary = md5(time());
    $headers = "From: {$config['from_name']} <{$config['from_email']}>\r\n";
    $headers .= "Reply-To: {$config['from_email']}\r\n";
    $headers .= "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n";

    // Build message
    $message = "--{$boundary}\r\n";
    $message .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $message .= "Content-Transfer-Encoding: 7bit\r\n\r\n";
    $message .= strip_tags($body) . "\r\n\r\n";
    $message .= "--{$boundary}\r\n";
    $message .= "Content-Type: text/html; charset=UTF-8\r\n";
    $message .= "Content-Transfer-Encoding: 7bit\r\n\r\n";
    $message .= $body . "\r\n\r\n";
    $message .= "--{$boundary}--";

    // Try to send via SMTP
    try {
        $result = smtpMail($to, $subject, $message, $headers);
        if ($result) {
            logDebug("Email sent successfully to: $to");
            return true;
        }
    } catch (Exception $e) {
        logError("Failed to send email: " . $e->getMessage());
    }

    return false;
}

/**
 * Send email via SMTP using socket connection
 * This is a simple SMTP implementation without external dependencies
 */
function smtpMail($to, $subject, $message, $headers) {
    $config = getSMTPConfig();

    // Connect to SMTP server
    $errno = 0;
    $errstr = '';
    $timeout = 30;

    $socket = @fsockopen(
        ($config['secure'] === 'ssl' ? 'ssl://' : '') . $config['host'],
        $config['port'],
        $errno,
        $errstr,
        $timeout
    );

    if (!$socket) {
        logError("SMTP connection failed: $errstr ($errno)");
        return false;
    }

    // Read greeting banner
    $greeting = fgets($socket, 512);
    if (substr($greeting, 0, 3) != '220') {
        logError("SMTP greeting failed: " . trim($greeting));
        fclose($socket);
        return false;
    }

    // Send EHLO first (required before STARTTLS)
    fputs($socket, "EHLO " . $_SERVER['HTTP_HOST'] . "\r\n");
    $response = '';
    while ($line = fgets($socket, 512)) {
        $response .= $line;
        if (substr($line, 3, 1) === ' ') break;
    }
    if (substr($response, 0, 3) != '250') {
        logError("EHLO failed: " . trim($response));
        fclose($socket);
        return false;
    }

    // Enable TLS if needed
    if ($config['secure'] === 'tls') {
        fputs($socket, "STARTTLS\r\n");
        $response = fgets($socket, 512);
        if (substr($response, 0, 3) != '220') {
            logError("STARTTLS failed: " . trim($response));
            fclose($socket);
            return false;
        }

        $cryptoMethod = STREAM_CRYPTO_METHOD_TLS_CLIENT;
        if (defined('STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT')) {
            $cryptoMethod |= STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT;
        }

        if (!stream_socket_enable_crypto($socket, true, $cryptoMethod)) {
            logError("TLS negotiation failed");
            fclose($socket);
            return false;
        }
    }

    // After TLS, send EHLO again
    if ($config['secure'] === 'tls') {
        fputs($socket, "EHLO " . $_SERVER['HTTP_HOST'] . "\r\n");
        $response = '';
        while ($line = fgets($socket, 512)) {
            $response .= $line;
            if (substr($line, 3, 1) === ' ') break;
        }
        if (substr($response, 0, 3) != '250') {
            logError("EHLO after TLS failed: " . trim($response));
            fclose($socket);
            return false;
        }
    }

    // SMTP authentication and sending
    $commands = [
        "AUTH LOGIN\r\n",
        base64_encode($config['username']) . "\r\n",
        base64_encode($config['password']) . "\r\n",
        "MAIL FROM: <{$config['from_email']}>\r\n",
        "RCPT TO: <$to>\r\n",
        "DATA\r\n",
        "Subject: $subject\r\n$headers\r\n$message\r\n.\r\n",
        "QUIT\r\n"
    ];

    $expectedCodes = ['334', '334', '235', '250', '250', '354', '250', '221'];

    foreach ($commands as $i => $command) {
        if (!fputs($socket, $command)) {
            logError("SMTP write failed at step $i");
            fclose($socket);
            return false;
        }

        $response = '';
        while ($line = fgets($socket, 512)) {
            $response .= $line;
            if (substr($line, 3, 1) === ' ') break;
        }

        if (substr($response, 0, 3) != $expectedCodes[$i]) {
            logError("SMTP error at step $i: " . trim($response));
            fputs($socket, "QUIT\r\n");
            fclose($socket);
            return false;
        }
    }

    fclose($socket);
    return true;
}
