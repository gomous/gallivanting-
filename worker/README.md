# Gallivanter API Worker

A Cloudflare Worker that provides Google OAuth authentication and Google Drive storage for the Gallivanter CRM application.

## Setup

### 1. Install Wrangler

```bash
npm install
```

### 2. Configure Google OAuth

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Enable the Google Drive API and Google People API
4. Create OAuth 2.0 credentials (Web Application type)
5. Set the authorized redirect URI to:
   ```
   https://gallivanter-api.jolly-rain-7712.workers.dev/auth/callback
   ```
6. Copy the Client ID and Client Secret

### 3. Deploy Secrets

```bash
wrangler secret put CLIENT_SECRET
wrangler secret put CLIENT_ID
```

> The `CLIENT_ID` and `REDIRECT_URI` are stored in `wrangler.toml` as plain vars, but `CLIENT_SECRET` must be set as a secret.

### 4. Deploy

```bash
wrangler deploy
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/google` | Start Google OAuth flow |
| GET | `/auth/callback` | OAuth callback (handled by Google) |
| POST | `/auth/logout` | Clear session |
| GET | `/auth/status` | Check if authenticated |
| GET | `/drive/workspace` | Read workspace from Drive |
| POST | `/drive/workspace` | Write workspace to Drive |
| GET | `/health` | Health check |

## Architecture

The worker acts as a reverse proxy between the Gallivanter frontend and Google's APIs. It:

1. Manages OAuth 2.0 authorization code flow with PKCE-style state tokens
2. Stores session tokens in HTTP-only cookies
3. Automatically refreshes Google access tokens when they expire
4. Finds/creates a workspace JSON file in the user's Google Drive
5. Proxies read/write requests to the Drive API

## Local Development

```bash
npm run dev
```

This starts the worker in development mode on `http://localhost:8787`.

To use it with the Gallivanter frontend, update `vite.config.ts` to proxy `/auth` and `/drive` requests to the worker URL.
