# Fleeterbase

A cloud-synced rental operations workspace for independent hosts. It includes a public landing page, secure account onboarding, empty-state dashboard, vehicle and reservation workflows, Turo CSV and Gmail imports, live fleet mapping, route history, pickup navigation, account/profile settings, notification preferences, integration setup states, and workspace export/reset controls.

## Run

```bash
npm install
npm run dev
```

Accounts and workspace records are stored in Cloudflare D1 and sync across signed-in devices. Passwords use unique salts and PBKDF2-HMAC-SHA256 with a 600,000-iteration work factor; session tokens are random, stored only as hashes in D1, and delivered in Secure, HttpOnly cookies. Browser storage is retained only as a password-free migration cache. New accounts begin empty unless the browser contains records that the user migrates during signup; Fleeterbase does not seed demo vehicles, guests, reservations, or locations.

Turo CSV files are parsed in the browser and imported records are saved to the cloud workspace. Bouncie has a real server integration: OAuth 2.0 with PKCE, encrypted rotating token storage, authenticated owner controls, webhook verification and deduplication, VIN/IMEI vehicle matching, and 15-second browser sync into the live map. Gmail uses Google OAuth, the read-only Gmail scope, encrypted token storage, Turo-message discovery, a review queue, and duplicate-resistant imports. Tesla and Stripe remain disconnected until their provider flows are built. See [OBD_RESEARCH.md](./OBD_RESEARCH.md) for the supported-hardware research.

## Cloudflare production

The Worker entry point is `worker/index.ts`, the D1 migrations live in `migrations/`, and `wrangler.jsonc` is the deployment source of truth. Apply migrations before deploying a version that depends on them:

```bash
npm run cf:types
npx wrangler d1 migrations apply fleeterbase-production --remote
npm run cf:build
npx wrangler deploy
```

Cloud account endpoints are under `/api/auth/*`; authenticated workspace reads and revision-checked writes use `/api/workspace`. Do not store production passwords, provider credentials, or encryption keys in Wrangler variables or Git.

## Run the integration-capable server

1. Copy `.env.example` to `.env` and replace every placeholder. The app does not load `.env` automatically; export the values through your service manager or shell.
2. Register a Bouncie developer application. Set its redirect URL to the exact `BOUNCIE_REDIRECT_URI` and its webhook URL to `https://fleeterbase.com/api/bouncie/webhook`.
3. Subscribe the webhook to at least `tripData`; trip start/end and health events may also be enabled.
4. Run `npm run build`, then `npm start`.
5. In Fleeterbase, open Settings → Integrations, unlock the server with the configured owner credentials, connect Bouncie, load its vehicles, and save each match.

### Enable Gmail Turo imports

1. In Google Cloud, create a project, enable the Gmail API, configure an OAuth consent screen, and create an OAuth client of type **Web application**.
2. Add the exact `GOOGLE_REDIRECT_URI` from `.env.example` as an authorized redirect URI. For local testing, use the origin served by `npm start`, such as `http://127.0.0.1:4173/api/gmail/callback`.
3. Export `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`, then restart the server.
4. In Settings → Integrations, unlock the server, connect Gmail, choose a search period, review the extracted trips, and import only the complete records you want.

Fleeterbase requests `gmail.readonly`; it cannot send, change, or delete email. It stores encrypted OAuth tokens and safe connection/scan summaries, not complete email bodies. The parser is deliberately review-first because Turo email templates can vary. Google classifies Gmail read-only as a restricted scope, so a public production app must satisfy Google's OAuth verification requirements and may require a security assessment depending on how restricted data is handled.

## Domain and SEO

Production builds default to `https://fleeterbase.com`. The build injects that origin into the canonical and Open Graph tags and emits `robots.txt`, `sitemap.xml`, and `site.webmanifest`. Override `VITE_PUBLIC_SITE_URL` only for a deliberate alternate deployment, and verify the generated files again on the live domain.

The server refuses to start without owner authentication, a 32-byte encryption key, and a 32+ character session secret. Bouncie access and rotating refresh tokens are AES-256-GCM encrypted at rest. Location history and mapping data live under `FLEETERBASE_DATA_DIR`; secure and back up that directory.

Upgrades from the former Fleetbase name are automatic: legacy browser storage, owner-session cookies, and `FLEETBASE_*` environment variables remain readable. New deployments should use the `FLEETERBASE_*` names in `.env.example`.

Without provider-issued credentials and internet-reachable callback URLs, the local build can exercise the adapters, parser, encryption, UI, and webhook contract but cannot complete live Bouncie or Gmail authorization.
