# Fleetbase OBD and telematics research

Research checked August 28, 2026. Fleetbase should integrate cloud-connected telematics devices rather than generic Bluetooth code readers. A rental vehicle needs unattended cellular GPS, account authorization, and a documented API or webhook path; a Bluetooth ELM327-style reader normally needs a nearby phone and cannot reliably power a fleet map.

## Recommended support order

| Priority | Provider and hardware | Why it fits | Official integration path | Fleetbase status |
| --- | --- | --- | --- | --- |
| 1 | Bouncie OBD2 GPS tracker | Best initial fit for owner-operated rental fleets; designed for most OBD2 passenger vehicles, generally 1996 and newer | OAuth 2.0, REST API, authenticated webhooks, trip events, device events, MIL and battery events, geo-zones | Adapter ready; live credentials required |
| 2 | Zubie OBD-II GPS device | Strong rental and light-duty fleet fit with live GPS, vehicle health, trip points, diagnostics, and odometer data | Zinc OAuth 2.0, REST API, and webhooks | Provider adapter planned |
| 3 | Geotab GO9 and supported GO devices | Broad protocol and vehicle coverage for larger fleets; detailed GPS and engine logging | MyGeotab API and data feeds | Enterprise adapter planned |
| 4 | Samsara VG34 and VG54 gateways | Rich GPS, OBD, fault-code, odometer, route, and webhook support for enterprise fleets | Scoped API tokens, Vehicle Stats feeds, Routing APIs, and webhooks | Enterprise adapter planned |

## Official evidence

- [Bouncie API documentation](https://docs.bouncie.dev/) documents OAuth 2.0, REST endpoints, webhooks, trips, device events, vehicle-health events, and geo-zones. Its [vehicle compatibility guide](https://help.bouncie.com/en/articles/1021667-compatible-vehicles) says vehicles with an OBD2 port are the target and notes the 1996-and-newer passenger-vehicle baseline.
- [Zubie Zinc getting started](https://developer.zubie.com/overview/getting-started) documents OAuth 2.0, REST access, and webhook-triggered integrations. Its [trip API](https://developer.zubie.com/reference/trips) includes GPS points, OBD and GPS distance, speed, heading, RPM, fuel, and odometer-related trip data.
- [Geotab's device API](https://developers.geotab.com/myGeotab/apiReference/objects/Device/index.html) lists GO9 and other GO device types. The [GO9 technical document](https://support.geotab.com/go-devices/go9/doc/go9-document) lists GPS plus OBD2, CAN, J1939, and other diagnostic protocols.
- [Samsara telematics documentation](https://developers.samsara.com/docs/telematics) documents real-time and historical GPS and onboard diagnostic data. Its REST overview identifies VG34 and VG54 as cellular vehicle gateways with GPS and CAN interfaces and documents route tracking APIs.

## Shared Fleetbase location contract

Each provider adapter should normalize its data to the same fields already used by the local map:

```json
{
  "vehicleId": "fleetbase-vehicle-id",
  "latitude": 28.538336,
  "longitude": -81.379234,
  "address": "Provider reverse-geocoded address",
  "speed": 18,
  "source": "Bouncie",
  "recordedAt": "2026-08-28T22:00:00.000Z"
}
```

Provider tokens and webhook secrets must live on a server, not in browser storage. OAuth state and PKCE must be verified, webhook signatures or authorization headers must be validated, and raw location retention should be configurable because rental vehicle location is sensitive data.

## Current product boundary

The Live map supports manual check-ins, Bouncie webhook locations, route history, latest-location selection, and Google Maps or Apple Maps navigation. The Bouncie adapter includes secure owner authentication, OAuth state and PKCE, encrypted rotating token storage, authenticated webhook ingestion, retry deduplication, VIN/IMEI mapping, and browser sync. A real device is not shown as connected until Bouncie issues application credentials and the production callback/webhook URLs are configured. Zubie is the next provider candidate; Geotab and Samsara should remain enterprise options until customer demand justifies their account and hardware requirements.
