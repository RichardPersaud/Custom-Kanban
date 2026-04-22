<?php
/**
 * Google OAuth Configuration
 *
 * Set GOOGLE_CLIENT_ID in your environment or replace the default value below.
 * Get your Client ID from: https://console.cloud.google.com/apis/credentials
 *
 * Steps:
 * 1. Go to https://console.cloud.google.com/apis/credentials
 * 2. Create a new project or select existing
 * 3. Click "Create Credentials" → "OAuth client ID"
 * 4. Select "Web application"
 * 5. Add authorized JavaScript origins:
 *    - http://localhost
 *    - http://localhost:8080
 *    - Your production domain
 * 6. Copy the Client ID and set it as GOOGLE_CLIENT_ID environment variable
 */

// Get Client ID from environment variable or use placeholder
$googleClientId = getenv('GOOGLE_CLIENT_ID') ?: '';

/**
 * Get Google Client ID
 * @return string|null Client ID or null if not configured
 */
function getGoogleClientId() {
    global $googleClientId;
    return !empty($googleClientId) ? $googleClientId : null;
}

/**
 * Check if Google OAuth is configured
 * @return bool
 */
function isGoogleOAuthConfigured() {
    return getGoogleClientId() !== null;
}
