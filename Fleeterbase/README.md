# Fleeterbase

A local-first rental operations workspace for independent hosts. It includes a public landing page, account onboarding, empty-state dashboard, vehicle and reservation workflows, Turo CSV imports, live fleet mapping, route history, pickup navigation, account/profile settings, notification preferences, integration setup states, and workspace export/reset controls.

## Run

```bash
npm install
npm run dev
```

Account, workspace, and manual location history are saved in browser local storage. New accounts begin empty; Fleeterbase does not seed demo vehicles, guests, reservations, or locations.

Turo CSV import is local. Bouncie now has a real server integration: OAuth 2.0 with PKCE, encrypted rotating token storage, authenticated owner controls, webhook verification and deduplication, VIN/IMEI vehicle matching, and 15-second browser sync into the live map. Gmail, Tesla, and Stripe remain disconnected until their provider flows are built. See [OBD_RESEARCH.md](./OBD_RESEARCH.md) for the supported-hardware research.

## Run the Bouncie-capable server

1. Copy `.env.example` to `.env` and replace every placeholder. The app does not load `.env` automatically; export the values through your service manager or shell.
2. Register a Bouncie developer application. Set its redirect URL to the exact `BOUNCIE_REDIRECT_URI` and its webhook URL to `https://your-fleet-domain/api/bouncie/webhook`.
3. Subscribe the webhook to at least `tripData`; trip start/end and health events may also be enabled.
4. Run `npm run build`, then `npm start`.
5. In Fleeterbase, open Settings → Integrations, unlock the server with the configured owner credentials, connect Bouncie, load its vehicles, and save each match.

The server refuses to start without owner authentication, a 32-byte encryption key, and a 32+ character session secret. Bouncie access and rotating refresh tokens are AES-256-GCM encrypted at rest. Location history and mapping data live under `FLEETERBASE_DATA_DIR`; secure and back up that directory.

Upgrades from the former Fleetbase name are automatic: legacy browser storage, owner-session cookies, and `FLEETBASE_*` environment variables remain readable. New deployments should use the `FLEETERBASE_*` names in `.env.example`.

Without Bouncie-issued client credentials and an internet-reachable HTTPS callback/webhook URL, the local build can exercise the full adapter and webhook contract but cannot complete a live Bouncie account authorization.
