import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createOAuthRequest, fetchVehicles, normalizeWebhook, refreshAccessToken } from '../server/bouncie.mjs';
import { FleetbaseStore } from '../server/store.mjs';

test('Bouncie authorization uses state and S256 PKCE', () => {
  const request = createOAuthRequest({ clientId: 'fleetbase-test', redirectUri: 'https://fleet.example/callback' });
  const url = new URL(request.url);
  assert.equal(url.origin + url.pathname, 'https://auth.bouncie.com/dialog/authorize');
  assert.equal(url.searchParams.get('state'), request.state);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.ok(request.verifier.length >= 43);
});

test('Bouncie REST calls send the raw token without a Bearer prefix', async () => {
  let authorization;
  const fetchImpl = async (_url, options) => {
    authorization = options.headers.authorization;
    return new Response(JSON.stringify([{ imei: '123', vin: 'abc', make: 'Toyota', model: 'Camry', year: 2022 }]), { status: 200 });
  };
  const vehicles = await fetchVehicles('raw-access-token', fetchImpl);
  assert.equal(authorization, 'raw-access-token');
  assert.equal(vehicles[0].vin, 'ABC');
  assert.equal(vehicles[0].imei, '123');
});

test('refresh uses the rotating refresh token response', async () => {
  let sent;
  const tokens = await refreshAccessToken({ clientId: 'id', clientSecret: 'secret' }, 'old-refresh', async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'Bearer' }), { status: 200 });
  });
  assert.equal(sent.refresh_token, 'old-refresh');
  assert.equal(tokens.refreshToken, 'new-refresh');
  assert.equal(tokens.accessToken, 'new-access');
});

test('webhook normalization accepts Bouncie tripData GPS payloads and arrays', () => {
  const normalized = normalizeWebhook({ eventType: 'tripData', imei: '3599', data: [
    { timestamp: '2026-08-28T12:00:00Z', gps: { lat: 28.5, lon: -81.3, speed: 22 } },
    { timestamp: '2026-08-28T12:00:10Z', gps: { latitude: 28.6, longitude: -81.4 }, vin: 'abc123' },
  ] }, 'raw-event');
  assert.equal(normalized.points.length, 2);
  assert.deepEqual(normalized.points[0].providerKeys, ['imei:3599']);
  assert.equal(normalized.points[0].speed, 22);
  assert.ok(normalized.points[1].providerKeys.includes('vin:ABC123'));
});

test('store encrypts tokens, deduplicates webhooks, and resolves mappings at read time', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fleetbase-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new FleetbaseStore(directory, Buffer.alloc(32, 7).toString('base64'));
  await store.init();
  await store.saveTokens({ accessToken: 'secret-access', refreshToken: 'secret-refresh', expiresAt: '2099-01-01T00:00:00Z' });
  const disk = await readFile(path.join(directory, 'bouncie-tokens.enc.json'), 'utf8');
  assert.equal(disk.includes('secret-access'), false);
  assert.equal((await store.getTokens()).refreshToken, 'secret-refresh');
  const webhook = { eventId: 'event-1', eventType: 'tripData', points: [{ id: 'event-1', providerKeys: ['vin:VIN123'], latitude: 28.5, longitude: -81.3, speed: 0, address: '', recordedAt: '2026-08-28T12:00:00Z', source: 'Bouncie', eventType: 'tripData' }] };
  assert.deepEqual(await store.recordWebhook(webhook), { duplicate: false, storedPoints: 1 });
  assert.deepEqual(await store.recordWebhook(webhook), { duplicate: true, storedPoints: 0 });
  assert.equal((await store.listLocations()).length, 0);
  await store.saveMappings([{ vehicleId: 'fleet-1', providerKeys: ['vin:VIN123'] }]);
  const points = await store.listLocations();
  assert.equal(points[0].vehicleId, 'fleet-1');
});
