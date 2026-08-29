# Fleetbase

A local-first rental operations workspace for independent hosts. It includes a public landing page, account onboarding, empty-state dashboard, vehicle and reservation workflows, Turo CSV imports, live fleet mapping, route history, pickup navigation, account/profile settings, notification preferences, integration setup states, and workspace export/reset controls.

## Run

```bash
npm install
npm run dev
```

Account, workspace, and manual location history are saved in browser local storage. New accounts begin empty; Fleetbase does not seed demo vehicles, guests, reservations, or locations.

Provider integrations such as Gmail, Tesla, Bouncie, Zubie, Geotab, Samsara, and Stripe remain disconnected until production authorization and backend services are configured. See [OBD_RESEARCH.md](./OBD_RESEARCH.md) for the supported-hardware recommendation and implementation boundaries.
