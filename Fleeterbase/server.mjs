import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { constantTimeMatch, createOAuthRequest, exchangeAuthorizationCode, fetchVehicles, refreshAccessToken, normalizeWebhook } from './server/bouncie.mjs';
import { createGoogleOAuthRequest, exchangeGoogleCode, fetchGmailProfile, refreshGoogleToken, revokeGoogleToken, scanTuroMessages } from './server/gmail.mjs';
import { FleeterbaseStore } from './server/store.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT || 4173);
const isProduction = process.env.NODE_ENV === 'production';
const sessionCookie = 'fleeterbase_owner';
const config = {
  ownerEmail: String(process.env.FLEETERBASE_OWNER_EMAIL || process.env.FLEETBASE_OWNER_EMAIL || '').trim().toLowerCase(),
  ownerPassword: String(process.env.FLEETERBASE_OWNER_PASSWORD || process.env.FLEETBASE_OWNER_PASSWORD || ''),
  sessionSecret: String(process.env.FLEETERBASE_SESSION_SECRET || process.env.FLEETBASE_SESSION_SECRET || ''),
  dataDirectory: process.env.FLEETERBASE_DATA_DIR || process.env.FLEETBASE_DATA_DIR || path.join(root, '.data'),
  encryptionKey: process.env.FLEETERBASE_TOKEN_ENCRYPTION_KEY || process.env.FLEETBASE_TOKEN_ENCRYPTION_KEY || '',
  bouncie: {
    clientId: String(process.env.BOUNCIE_CLIENT_ID || ''),
    clientSecret: String(process.env.BOUNCIE_CLIENT_SECRET || ''),
    redirectUri: String(process.env.BOUNCIE_REDIRECT_URI || ''),
    webhookKey: String(process.env.BOUNCIE_WEBHOOK_KEY || ''),
  },
  gmail: {
    clientId: String(process.env.GOOGLE_CLIENT_ID || ''),
    clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || ''),
    redirectUri: String(process.env.GOOGLE_REDIRECT_URI || ''),
  },
};

const missingCore = [
  ['FLEETERBASE_OWNER_EMAIL', config.ownerEmail],
  ['FLEETERBASE_OWNER_PASSWORD', config.ownerPassword],
  ['FLEETERBASE_SESSION_SECRET', config.sessionSecret.length >= 32],
  ['FLEETERBASE_TOKEN_ENCRYPTION_KEY', config.encryptionKey],
].filter(([, value]) => !value).map(([name]) => name);
if (missingCore.length) {
  console.error(`Fleeterbase server configuration missing: ${missingCore.join(', ')}`);
  process.exit(1);
}

const store = new FleeterbaseStore(config.dataDirectory, config.encryptionKey);
await store.init();
const loginAttempts = new Map();

const configuredForBouncie = () => Boolean(config.bouncie.clientId && config.bouncie.clientSecret && config.bouncie.redirectUri && config.bouncie.webhookKey);
const configuredForGmail = () => Boolean(config.gmail.clientId && config.gmail.clientSecret && config.gmail.redirectUri);
const json = (response, status, body, headers = {}) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
};
const redirect = (response, location, headers = {}) => { response.writeHead(302, { location, 'cache-control': 'no-store', ...headers }); response.end(); };

function cookies(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map(item => item.trim().split('=').map(decodeURIComponent)).filter(parts => parts.length === 2));
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${createHmac('sha256', config.sessionSecret).update(encoded).digest('base64url')}`;
}

function validSession(request) {
  const requestCookies = cookies(request), token = requestCookies[sessionCookie] || requestCookies.fleetbase_owner;
  if (!token) return false;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return false;
  const expected = createHmac('sha256', config.sessionSecret).update(encoded).digest('base64url');
  const actualBuffer = Buffer.from(signature), expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return payload.email === config.ownerEmail && payload.expiresAt > Date.now();
  } catch { return false; }
}

function setSessionHeader(request) {
  const token = signSession({ email: config.ownerEmail, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
  return `${sessionCookie}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${isProduction || request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;
}

function clearSessionHeader() {
  const suffix = `; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isProduction ? '; Secure' : ''}`;
  return [`${sessionCookie}=${suffix}`, `fleetbase_owner=${suffix}`];
}

async function body(request, maximum = 1_000_000) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maximum) { const error = new Error('Request body is too large.'); error.status = 413; throw error; }
  }
  if (!raw) return { raw, value: {} };
  try { return { raw, value: JSON.parse(raw) }; }
  catch { const error = new Error('Request body must be valid JSON.'); error.status = 400; throw error; }
}

function requireSession(request, response) {
  if (validSession(request)) return true;
  json(response, 401, { error: 'Owner sign-in required.' });
  return false;
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const expected = `${request.headers['x-forwarded-proto'] || 'http'}://${request.headers.host}`;
  return origin === expected;
}

async function activeTokens() {
  let tokens = await store.getTokens();
  if (!tokens) { const error = new Error('Connect a Bouncie account first.'); error.status = 409; throw error; }
  if (new Date(tokens.expiresAt).getTime() <= Date.now() + 60_000) {
    tokens = await refreshAccessToken(config.bouncie, tokens.refreshToken);
    await store.saveTokens(tokens);
  }
  return tokens;
}

async function activeGmailTokens() {
  let tokens = await store.getGmailTokens();
  if (!tokens) { const error = new Error('Connect a Gmail account first.'); error.status = 409; throw error; }
  if (new Date(tokens.expiresAt).getTime() <= Date.now() + 60_000) {
    tokens = await refreshGoogleToken(config.gmail, tokens.refreshToken);
    await store.saveGmailTokens(tokens);
  }
  return tokens;
}

function mappingKeys(item) {
  return [...new Set([
    item.imei && `imei:${String(item.imei).trim()}`,
    item.vin && `vin:${String(item.vin).trim().toUpperCase()}`,
    ...(Array.isArray(item.providerKeys) ? item.providerKeys : []),
  ].filter(key => /^((imei)|(vin)):[A-Za-z0-9-]+$/.test(key)))];
}

async function api(request, response, url) {
  if (request.method === 'POST' && url.pathname === '/api/session') {
    if (!sameOrigin(request)) return json(response, 403, { error: 'Cross-origin sign-in blocked.' });
    const remote = request.socket.remoteAddress || 'unknown', now = Date.now(), attempt = loginAttempts.get(remote);
    if (attempt?.blockedUntil > now) return json(response, 429, { error: 'Too many sign-in attempts. Try again later.' });
    const { value } = await body(request, 10_000);
    const emailOk = constantTimeMatch(String(value.email || '').toLowerCase(), config.ownerEmail);
    const passwordOk = constantTimeMatch(value.password, config.ownerPassword);
    if (!emailOk || !passwordOk) {
      const failures = attempt?.firstAt > now - 15 * 60 * 1000 ? attempt.failures + 1 : 1;
      loginAttempts.set(remote, { failures, firstAt: failures === 1 ? now : attempt.firstAt, blockedUntil: failures >= 5 ? now + 15 * 60 * 1000 : 0 });
      return json(response, 401, { error: 'Email or password is incorrect.' });
    }
    loginAttempts.delete(remote);
    return json(response, 200, { authenticated: true }, { 'set-cookie': setSessionHeader(request) });
  }
  if (request.method === 'GET' && url.pathname === '/api/session') return json(response, 200, { authenticated: validSession(request) });
  if (request.method === 'DELETE' && url.pathname === '/api/session') {
    if (!sameOrigin(request)) return json(response, 403, { error: 'Cross-origin request blocked.' });
    return json(response, 200, { authenticated: false }, { 'set-cookie': clearSessionHeader() });
  }
  if (request.method === 'POST' && url.pathname === '/api/bouncie/webhook') {
    if (!configuredForBouncie()) return json(response, 503, { error: 'Bouncie is not configured.' });
    const suppliedKey = request.headers['x-bouncie-authorization'] || request.headers.authorization;
    if (!constantTimeMatch(suppliedKey, config.bouncie.webhookKey)) return json(response, 401, { error: 'Webhook authorization failed.' });
    const { raw, value } = await body(request, 2_000_000);
    const result = await store.recordWebhook(normalizeWebhook(value, raw));
    return json(response, 200, { accepted: true, ...result });
  }
  if (!url.pathname.startsWith('/api/bouncie/') && !url.pathname.startsWith('/api/gmail/')) return false;
  if (!requireSession(request, response)) return true;
  if (request.method !== 'GET' && !sameOrigin(request)) return json(response, 403, { error: 'Cross-origin request blocked.' });

  if (request.method === 'GET' && url.pathname === '/api/gmail/status') {
    const tokens = await store.getGmailTokens(), status = await store.getGmailStatus();
    return json(response, 200, { ...status, configured: configuredForGmail(), connected: Boolean(tokens) });
  }
  if (request.method === 'GET' && url.pathname === '/api/gmail/connect') {
    if (!configuredForGmail()) return json(response, 503, { error: 'Add the Google OAuth environment settings before connecting Gmail.' });
    const pending = createGoogleOAuthRequest(config.gmail);
    await store.savePendingGoogleOAuth(pending);
    return redirect(response, pending.url);
  }
  if (request.method === 'GET' && url.pathname === '/api/gmail/callback') {
    const pending = await store.getPendingGoogleOAuth(), code = url.searchParams.get('code'), state = url.searchParams.get('state');
    const fresh = pending && Date.now() - new Date(pending.createdAt).getTime() < 10 * 60 * 1000;
    if (!code || !fresh || !constantTimeMatch(state, pending.state)) return redirect(response, '/?gmail=error');
    try {
      const tokens = await exchangeGoogleCode(config.gmail, { code, verifier: pending.verifier });
      const profile = await fetchGmailProfile(tokens.accessToken);
      await Promise.all([
        store.saveGmailTokens(tokens),
        store.saveGmailStatus({ email: profile.email, connectedAt: new Date().toISOString() }),
        store.clearPendingGoogleOAuth(),
      ]);
      return redirect(response, '/?gmail=connected');
    } catch (error) {
      console.error('Google authorization exchange failed:', error.message);
      await store.clearPendingGoogleOAuth();
      return redirect(response, '/?gmail=error');
    }
  }
  if (request.method === 'DELETE' && url.pathname === '/api/gmail/connection') {
    const tokens = await store.getGmailTokens();
    let revoked = false;
    try { if (tokens) { await revokeGoogleToken(tokens.refreshToken || tokens.accessToken); revoked = true; } }
    catch (error) { console.error('Google token revocation failed:', error.message); }
    await Promise.all([store.clearGmailTokens(), store.saveGmailStatus({})]);
    return json(response, 200, { connected: false, revoked });
  }
  if (request.method === 'POST' && url.pathname === '/api/gmail/scan') {
    const { value } = await body(request, 10_000), months = Math.min(Math.max(Number(value.months || 6), 1), 24);
    const tokens = await activeGmailTokens(), afterEpoch = Math.floor(Date.now() / 1000 - months * 30 * 86400);
    const result = await scanTuroMessages(tokens.accessToken, { afterEpoch, maxResults: 100 });
    const previous = await store.getGmailStatus(), scanStatus = { ...previous, lastScanAt: new Date().toISOString(), lastResultCount: result.candidates.length };
    await store.saveGmailStatus(scanStatus);
    return json(response, 200, result);
  }

  if (request.method === 'GET' && url.pathname === '/api/bouncie/status') {
    const tokens = await store.getTokens(), mappings = await store.getMappings(), status = await store.status();
    return json(response, 200, { configured: configuredForBouncie(), connected: Boolean(tokens), mappingCount: mappings.length, ...status });
  }
  if (request.method === 'GET' && url.pathname === '/api/bouncie/connect') {
    if (!configuredForBouncie()) return json(response, 503, { error: 'Add the Bouncie environment settings before connecting.' });
    const pending = createOAuthRequest(config.bouncie);
    await store.savePendingOAuth(pending);
    return redirect(response, pending.url);
  }
  if (request.method === 'GET' && url.pathname === '/api/bouncie/callback') {
    const pending = await store.getPendingOAuth();
    const code = url.searchParams.get('code'), state = url.searchParams.get('state');
    const fresh = pending && Date.now() - new Date(pending.createdAt).getTime() < 10 * 60 * 1000;
    if (!code || !fresh || !constantTimeMatch(state, pending.state)) return redirect(response, '/?bouncie=error');
    try {
      const tokens = await exchangeAuthorizationCode(config.bouncie, { code, verifier: pending.verifier });
      await store.saveTokens(tokens);
      await store.clearPendingOAuth();
      return redirect(response, '/?bouncie=connected');
    } catch (error) {
      console.error('Bouncie authorization exchange failed:', error.message);
      await store.clearPendingOAuth();
      return redirect(response, '/?bouncie=error');
    }
  }
  if (request.method === 'DELETE' && url.pathname === '/api/bouncie/connection') {
    await store.clearTokens();
    return json(response, 200, { connected: false });
  }
  if (request.method === 'GET' && url.pathname === '/api/bouncie/vehicles') {
    const tokens = await activeTokens();
    return json(response, 200, { vehicles: await fetchVehicles(tokens.accessToken) });
  }
  if (request.method === 'PUT' && url.pathname === '/api/bouncie/mappings') {
    const { value } = await body(request, 100_000);
    if (!Array.isArray(value.mappings)) return json(response, 400, { error: 'Mappings must be an array.' });
    const mappings = value.mappings.map(item => ({ vehicleId: String(item.vehicleId || '').trim(), providerKeys: mappingKeys(item) })).filter(item => item.vehicleId && item.providerKeys.length);
    if (mappings.length > 500) return json(response, 400, { error: 'Too many vehicle mappings.' });
    await store.saveMappings(mappings);
    return json(response, 200, { mappings });
  }
  if (request.method === 'GET' && url.pathname === '/api/bouncie/locations') {
    const points = await store.listLocations({ since: url.searchParams.get('since') || '', limit: url.searchParams.get('limit') || 1000 });
    return json(response, 200, { points });
  }
  return json(response, 404, { error: 'API route not found.' });
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };
async function staticFile(request, response, url) {
  if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Method not allowed.' });
  let target = path.join(dist, decodeURIComponent(url.pathname));
  if (!target.startsWith(dist)) return json(response, 403, { error: 'Forbidden.' });
  try { if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html'); }
  catch { target = path.join(dist, 'index.html'); }
  try { await access(target); }
  catch { return json(response, 503, { error: 'Fleeterbase has not been built. Run npm run build first.' }); }
  response.writeHead(200, {
    'content-type': mime[path.extname(target)] || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'content-security-policy': "default-src 'self'; script-src 'self' 'sha256-P8CErvsYjPD+U3WA5u1mvLpBWJHLRX4t2TSmcd7p6ls='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  if (request.method === 'HEAD') return response.end();
  createReadStream(target).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const handled = await api(request, response, url);
    if (handled !== false) return;
    await staticFile(request, response, url);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) json(response, error.status || 500, { error: error.status && error.status < 500 ? error.message : 'Unexpected server error.' });
    else response.destroy();
  }
});

server.listen(port, () => console.log(`Fleeterbase listening on http://127.0.0.1:${port}`));
