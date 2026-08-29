import assert from 'node:assert/strict';
import test from 'node:test';
import { automateFleet, fleetAlerts } from '../src/fleetAutomation.js';

test('fleet automation advances reservation and vehicle statuses without changing canceled trips', () => {
  const reservations = [
    { id: 'past', vehicleId: 'v1', guest: 'Past', start: '2026-08-20', end: '2026-08-21', status: 'Confirmed' },
    { id: 'active', vehicleId: 'v2', guest: 'Active', start: '2026-08-29', end: '2026-08-30', status: 'Confirmed' },
    { id: 'canceled', vehicleId: 'v3', guest: 'Canceled', start: '2026-08-29', end: '2026-08-30', status: 'Canceled' },
  ];
  const vehicles = [{ id: 'v1', status: 'On trip' }, { id: 'v2', status: 'Available' }, { id: 'v3', status: 'Service' }];
  const result = automateFleet(vehicles, reservations, new Date('2026-08-29T12:00:00'));
  assert.deepEqual(result.reservations.map(item => item.status), ['Completed', 'Active', 'Canceled']);
  assert.deepEqual(result.vehicles.map(item => item.status), ['Available', 'On trip', 'Service']);
});

test('fleet alerts surface pickups, returns, and maintenance attention', () => {
  const reservations = [{ id: 'r1', guest: 'Alex', start: '2026-08-29', end: '2026-08-29', status: 'Active' }];
  const vehicles = [{ id: 'v1', name: 'Toyota Camry', status: 'Available', maintenance: 'Due' }];
  const alerts = fleetAlerts(vehicles, reservations, new Date('2026-08-29T08:00:00'));
  assert.deepEqual(alerts.map(item => item.id), ['pickup-r1', 'return-r1', 'service-v1']);
});
