# Google OAuth Setup Guide

To enable Google Sign-In for your Kanban app, follow these steps:

## 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Enter a project name (e.g., "Kanban App")
4. Click "Create"

## 2. Enable Google Sign-In API

1. In your project, go to "APIs & Services" → "Library"
2. Search for "Google Identity Toolkit" or "Google Sign-In"
3. Click "Enable"

## 3. Create OAuth Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. Configure the OAuth consent screen:
   - User Type: External
   - Fill in required fields (App name, User support email, Developer contact info)
   - Scopes: Add `openid`, `email`, `profile`
   - Add test users (your email)
4. Create the OAuth client ID:
   - Application type: Web application
   - Name: Kanban App
   - Authorized JavaScript origins:
     - `http://localhost`
     - `http://localhost:8080` (if using docker)
     - `https://your-domain.com` (for production)
   - Authorized redirect URIs:
     - `http://localhost/auth.html`
     - `https://your-domain.com/auth.html`
5. Click "Create" and copy the **Client ID**

## 4. Configure the App

### Option A: Using Environment Variable (Recommended)

Add the Client ID to your environment:

```bash
# For local development
export GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"

# For Docker, add to docker-compose.yml:
environment:
  - GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

### Option B: Hardcode in Config File

Edit `www/api/config/google-oauth.php` and replace the empty string with your Client ID:

```php
$googleClientId = getenv('GOOGLE_CLIENT_ID') ?: 'your-client-id.apps.googleusercontent.com';
```

## 5. Test the Setup

1. Navigate to `http://localhost/auth.html`
2. You should see the "Continue with Google" button
3. Click it and sign in with your Google account
4. You should be redirected to the app and logged in

## Troubleshooting

### "Google Sign-In not configured" message
- The `GOOGLE_CLIENT_ID` environment variable is not set
- Check that `google-oauth.php` can read the environment variable

### "Invalid Google token" error
- The Client ID might be incorrect
- Make sure you're using the correct Client ID for your domain
- Check that the authorized JavaScript origin matches your URL

### "This app isn't verified" warning
- This is normal during development
- Click "Advanced" → "Go to [your app] (unsafe)"
- For production, you'll need to verify your app with Google

### Button doesn't appear
- Check browser console for JavaScript errors
- Verify the Google Sign-In API script is loading
- Check that `/api/auth/google-config.php` returns a valid client ID

## Security Notes

- Never commit your Google Client ID to version control
- Use environment variables for production deployments
- The Client ID is public and safe to expose in frontend code
- The Client Secret (if you have one) should never be exposed
- Always verify the token on the backend before creating sessions
