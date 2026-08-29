import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGoogleOAuthRequest, parseTuroMessage, refreshGoogleToken, scanTuroMessages } from '../server/gmail.mjs';
import { FleeterbaseStore } from '../server/store.mjs';

const encoded = value => Buffer.from(value).toString('base64url');
const gmailMessage = (body, subject = 'Alex Morgan booked your 2022 Toyota Camry') => ({
  id: 'message-123',
  internalDate: String(Date.parse('2026-08-20T12:00:00Z')),
  payload: {
    mimeType: 'text/plain',
    headers: [{ name: 'Subject', value: subject }, { name: 'From', value: 'Turo <noreply@turo.com>' }],
    body: { data: encoded(body) },
  },
});

test('Google authorization uses state, offline access, read-only Gmail, and S256 PKCE', () => {
  const request = createGoogleOAuthRequest({ clientId: 'google-client', redirectUri: 'https://fleet.example/api/gmail/callback' });
  const url = new URL(request.url);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('state'), request.state);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.readonly');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
});

test('Turo email parser extracts a reviewable trip without retaining message content', () => {
  const parsed = parseTuroMessage(gmailMessage(`Trip ID: TURO-98765
Guest: Alex Morgan
Vehicle: 2022 Toyota Camry
Pickup: 2026-08-30
Return: 2026-09-02
Host earnings: $450.50`));
  assert.equal(parsed.turoTripId, 'TURO-98765');
  assert.equal(parsed.guest, 'Alex Morgan');
  assert.equal(parsed.vehicleName, '2022 Toyota Camry');
  assert.equal(parsed.start, '2026-08-30');
  assert.equal(parsed.end, '2026-09-02');
  assert.equal(parsed.price, 450.5);
  assert.equal(parsed.ready, true);
  assert.equal(JSON.stringify(parsed).includes('Host earnings'), false);
});

test('incomplete Turo emails are flagged for review instead of silently importing', () => {
  const parsed = parseTuroMessage(gmailMessage('Your trip is confirmed.', 'Trip confirmed'));
  assert.equal(parsed.ready, false);
  assert.deepEqual(parsed.issues, ['guest name', 'vehicle', 'pickup date', 'return date']);
  assert.equal(parsed.turoTripId, 'gmail-message-123');
});

test('Gmail scan uses Bearer authorization, a Turo query, and message details', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), authorization: options.headers?.authorization });
    if (String(url).includes('/messages?')) return new Response(JSON.stringify({ messages: [{ id: 'message-123' }], resultSizeEstimate: 1 }), { status: 200 });
    return new Response(JSON.stringify(gmailMessage(`Guest: Alex Morgan
Vehicle: 2022 Toyota Camry
Pickup: 2026-08-30
Return: 2026-09-02`)), { status: 200 });
  };
  const result = await scanTuroMessages('access-token', { afterEpoch: 1700000000 }, fetchImpl);
  assert.match(decodeURIComponent(calls[0].url), /from:\(turo\.com\) after:1700000000/);
  assert.equal(calls[0].authorization, 'Bearer access-token');
  assert.match(calls[1].url, /\/messages\/message-123\?format=full$/);
  assert.equal(result.candidates.length, 1);
});

test('Google refresh preserves an existing refresh token when it is not rotated', async () => {
  let sent;
  const tokens = await refreshGoogleToken({ clientId: 'id', clientSecret: 'secret' }, 'old-refresh', async (_url, options) => {
    sent = Object.fromEntries(options.body);
    return new Response(JSON.stringify({ access_token: 'new-access', expires_in: 3600 }), { status: 200 });
  });
  assert.equal(sent.refresh_token, 'old-refresh');
  assert.equal(tokens.refreshToken, 'old-refresh');
  assert.equal(tokens.accessToken, 'new-access');
});

test('store encrypts Gmail access, refresh, and pending OAuth values', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fleeterbase-gmail-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new FleeterbaseStore(directory, Buffer.alloc(32, 5).toString('base64'));
  await store.init();
  await store.saveGmailTokens({ accessToken: 'gmail-access-secret', refreshToken: 'gmail-refresh-secret' });
  await store.savePendingGoogleOAuth({ state: 'oauth-state-secret', verifier: 'oauth-verifier-secret' });
  const tokenDisk = await readFile(path.join(directory, 'gmail-tokens.enc.json'), 'utf8');
  const pendingDisk = await readFile(path.join(directory, 'google-oauth-pending.enc.json'), 'utf8');
  assert.equal(tokenDisk.includes('gmail-access-secret'), false);
  assert.equal(pendingDisk.includes('oauth-state-secret'), false);
  assert.equal((await store.getGmailTokens()).refreshToken, 'gmail-refresh-secret');
  assert.equal((await store.getPendingGoogleOAuth()).verifier, 'oauth-verifier-secret');
});
