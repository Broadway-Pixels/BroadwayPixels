# Fleetbase

A local-first rental operations workspace for independent hosts. It includes a public landing page, account onboarding, empty-state dashboard, vehicle and reservation workflows, account/profile settings, notification preferences, integration setup states, and workspace export/reset controls.

## Run

```bash
npm install
npm run dev
```

Account and workspace data are saved in browser local storage. New accounts begin empty; Fleetbase does not seed demo vehicles, guests, or reservations.

Provider integrations such as Gmail, Tesla, Bouncie, and Stripe remain disconnected until production authorization and backend services are configured.
