# Gallivanter

Gallivanter is a local-first CRM workspace with a responsive web/PWA surface and an Electron desktop surface. The web build is the deployable application used by Cloudflare Pages; the Electron build produces desktop source bundles.

## Requirements

- Node.js **22.12.0**. The version is pinned in `.nvmrc` and enforced by `package.json`.
- npm 10 or newer, included with the pinned Node release.
- Docker Desktop only if you want to use the container workflow.

The project does not require Cloudflare or Google credentials to build, test, run locally, or use the local-first CRM behavior.

## Setup from a clean checkout

```bash
cd gallivanting-
nvm install
nvm use
cp .env.example .env
npm ci
```

On systems without `nvm`, install Node 22.12.0 using the platform's version manager and verify it:

```bash
node --version
npm --version
```

The first command should report `v22.12.0`.

## Run locally

### Web/PWA development server

```bash
npm run web:dev
```

Open <http://127.0.0.1:5173/>. This is the fastest way to work on the responsive PWA surface. The app falls back to browser-local storage when the optional Drive API is not available.

### Electron development

```bash
npm run electron:dev
```

This starts the Electron development shell. Electron is not required for the web/PWA Docker build.

## Build

Build the deployable web/PWA assets:

```bash
npm run web:build
```

The output is written to `dist/`.

Build the Electron main, preload, and renderer bundles:

```bash
npm run build
```

The output is written to `out/`. This repository currently does not package an installer; `npm run build` validates and bundles the Electron sources.

## Test and verification

Run the complete local verification command:

```bash
npm run verify
```

It performs:

1. TypeScript checking.
2. The repository test suite.
3. A production web/PWA build.

The standalone test command is:

```bash
npm test
```

## Docker

The Docker image builds the Vite web/PWA bundle in a pinned Node build stage and serves it with nginx. It does not require Google or Cloudflare credentials.

Build the image:

```bash
```

Run it:

```bash
```

Open <http://127.0.0.1:8080/>.

The nginx configuration includes SPA fallback routing, so refreshing a client-side route remains inside Gallivanter.

## Environment configuration

`.env.example` documents the supported local variable names. Copy it to `.env` for local work, but keep every value blank unless you are intentionally configuring an integration:

- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are only for a manually authorized Cloudflare deployment command.
- `VITE_GOOGLE_CLIENT_ID` is optional browser configuration.
- `ELECTRON_RENDERER_URL` and `CDP_ENDPOINT` are optional local tooling settings.

Never put tokens, OAuth secrets, private keys, or real credentials in `.env.example`, source code, Dockerfiles, GitHub workflows, or committed files. GitHub Actions deployment credentials belong in repository secrets named `CF_ACCOUNT_ID` and `CF_API_TOKEN`.

## Cloudflare Pages deployment

The GitHub workflow uses Node `.nvmrc`, runs `npm run verify`, and deploys the `dist/` directory with Wrangler:

```text
cloudflare/wrangler-action@v3
pages deploy dist --project-name gallivanter
```

Configure these GitHub repository secrets before enabling deployment:

- `CF_ACCOUNT_ID`
- `CF_API_TOKEN`

The token needs permission to deploy the `gallivanter` Pages project. Cloudflare Pages environment variables and Google OAuth redirect settings are configured in Cloudflare, not committed to this repository.

## Repository layout

```text
src/                    React CRM and PWA application
electron/               Electron main/preload and local persistence
functions/api/          Cloudflare Pages Functions API routes
public/                 PWA manifest, service worker, and static assets
docker/                 nginx configuration for the web container
.github/workflows/      CI and Pages deployment workflow
```

The legacy `worker/` directory is retained as a reference fallback. The default application build and deployment use the root project, `functions/`, Vite, and Cloudflare Pages.
