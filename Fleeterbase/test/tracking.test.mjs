import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinateIsValid, createTrackingPoint, latestByVehicle, navigationLinks } from '../src/tracking.js';

test('validates real-world coordinates', () => {
  assert.equal(coordinateIsValid(28.5383, -81.3792), true);
  assert.equal(coordinateIsValid(91, 20), false);
});

test('normalizes a manual vehicle check-in', () => {
  const point = createTrackingPoint({ vehicleId: 'v1', latitude: '28.5383', longitude: '-81.3792', address: ' Orlando ', speed: '12' }, 'p1', '2026-08-28T12:00:00.000Z');
  assert.deepEqual(point, { id: 'p1', vehicleId: 'v1', latitude: 28.5383, longitude: -81.3792, address: 'Orlando', speed: 12, source: 'Manual check-in', recordedAt: '2026-08-28T12:00:00.000Z' });
});

test('finds the latest location per vehicle and builds navigation links', () => {
  const points = [
    { vehicleId: 'v1', recordedAt: '2026-08-28T10:00:00Z', latitude: 1, longitude: 2 },
    { vehicleId: 'v1', recordedAt: '2026-08-28T11:00:00Z', latitude: 3, longitude: 4 },
  ];
  assert.equal(latestByVehicle(points).get('v1').latitude, 3);
  assert.match(navigationLinks(points[1]).google, /destination=3%2C4/);
  assert.match(navigationLinks(points[1]).apple, /daddr=3%2C4/);
});
