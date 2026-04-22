<?php
/**
 * Google OAuth Config Endpoint
 * Returns the Google Client ID for the frontend
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../config/google-oauth.php';

// Get the Client ID
$clientId = getGoogleClientId();

jsonResponse([
    'success' => true,
    'client_id' => $clientId,
    'configured' => isGoogleOAuthConfigured()
]);
