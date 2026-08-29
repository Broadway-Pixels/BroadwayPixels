import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import type Stripe from 'stripe';
import {
  createOAuthRequest,
  exchangeAuthorizationCode,
  fetchVehicles,
  normalizeWebhook,
  refreshAccessToken,
  type BouncieConfig,
  type OAuthRequest,
  type TokenSet,
} from '../server/bouncie.mjs';
import {
  createGoogleOAuthRequest,
  exchangeGoogleCode,
  fetchGmailProfile,
  refreshGoogleToken,
  revokeGoogleToken,
  scanTuroMessages,
  type GoogleConfig,
} from '../server/gmail.mjs';
import {
  clearLoginAttempt,
  clearSession,
  createSession,
  deleteState,
  getEncryptedState,
  getLoginAttempt,
  getMappings,
  getState,
  latestMappedLocationStatus,
  listLocations,
  pruneReceipts,
  recordLoginFailure,
  recordWebhook,
  saveMappings,
  setEncryptedState,
  setState,
  validSession,
  type WorkerEnv,
} from './store';
import {
  USER_SESSION_COOKIE,
  USER_SESSION_SECONDS,
  clearUserLoginAttempt,
  clearUserSession,
  cloudSession,
  createCloudAccount,
  createUserSession,
  loginAttempt,
  normalizeEmail,
  passwordMatches,
  passwordRecord,
  recordUserLoginFailure,
  saveWorkspace,
  userByEmail,
  validEmail,
  validateWorkspace,
  workspaceForUser,
  type CloudSession,
} from './accounts';
import {
  billingForUser,
  hasProAccess,
  markWebhookProcessed,
  saveStripeCustomer,
  saveSubscription,
  stripeClient,
  stripeConfigured,
  webhookProcessed,
} from './billing';

const SESSION_COOKIE = 'fleeterbase_owner';
const SESSION_SECONDS = 12 * 60 * 60;
const CSP = "default-src 'self'; script-src 'self' 'sha256-P8CErvsYjPD+U3WA5u1mvLpBWJHLRX4t2TSmcd7p6ls='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

class HttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', ...headers } });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
}

function cookieMap(request: Request): Map<string, string> {
  const result = new Map<string, string>();
  for (const item of (request.headers.get('cookie') || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    try { result.set(item.slice(0, separator).trim(), decodeURIComponent(item.slice(separator + 1).trim())); }
    catch { /* Ignore malformed cookies. */ }
  }
  return result;
}

function setSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function setUserSessionCookie(token: string): string {
  return `${USER_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${USER_SESSION_SECONDS}`;
}

function clearUserSessionCookie(): string {
  return `${USER_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

async function secureEqual(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash));
}

async function boundedJson(request: Request, maximum: number): Promise<unknown> {
  if (!request.body) return {};
  const stated = Number(request.headers.get('content-length') || 0);
  if (stated > maximum) throw new HttpError('Request body is too large.', 413);
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maximum) { await reader.cancel(); throw new HttpError('Request body is too large.', 413); }
    chunks.push(part.value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  try { return total ? JSON.parse(new TextDecoder().decode(merged)) : {}; }
  catch { throw new HttpError('Request body must be valid JSON.', 400); }
}

async function boundedText(request: Request, maximum: number): Promise<string> {
  if (!request.body) return '';
  const stated = Number(request.headers.get('content-length') || 0);
  if (stated > maximum) throw new HttpError('Request body is too large.', 413);
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maximum) { await reader.cancel(); throw new HttpError('Request body is too large.', 413); }
    chunks.push(part.value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError('Request body must be a JSON object.', 400);
  return value as Record<string, unknown>;
}

function stateObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function loginAttemptKey(request: Request, email: string): Promise<string> {
  const remote = request.headers.get('cf-connecting-ip') || 'unknown';
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${remote}\n${email}`))).toString('hex');
}

function isTokenSet(value: unknown): value is TokenSet {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<TokenSet>;
  return typeof item.accessToken === 'string' && typeof item.refreshToken === 'string' && typeof item.expiresAt === 'string' && typeof item.tokenType === 'string';
}

function isOAuthRequest(value: unknown): value is OAuthRequest {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<OAuthRequest>;
  return typeof item.state === 'string' && typeof item.verifier === 'string' && typeof item.createdAt === 'string' && typeof item.url === 'string';
}

function bouncieConfig(env: WorkerEnv): BouncieConfig {
  return { clientId: env.BOUNCIE_CLIENT_ID || '', clientSecret: env.BOUNCIE_CLIENT_SECRET || '', redirectUri: env.BOUNCIE_REDIRECT_URI, webhookKey: env.BOUNCIE_WEBHOOK_KEY || '' };
}

function googleConfig(env: WorkerEnv): GoogleConfig {
  return { clientId: env.GOOGLE_CLIENT_ID || '', clientSecret: env.GOOGLE_CLIENT_SECRET || '', redirectUri: env.GOOGLE_REDIRECT_URI };
}

function configuredForBouncie(env: WorkerEnv): boolean {
  return Boolean(env.BOUNCIE_CLIENT_ID && env.BOUNCIE_CLIENT_SECRET && env.BOUNCIE_WEBHOOK_KEY && env.BOUNCIE_REDIRECT_URI);
}

function configuredForGmail(env: WorkerEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
}

async function sessionAuthenticated(request: Request, env: WorkerEnv): Promise<boolean> {
  return validSession(env, cookieMap(request).get(SESSION_COOKIE) || '');
}

async function requireSession(request: Request, env: WorkerEnv): Promise<void> {
  if (!await sessionAuthenticated(request, env)) throw new HttpError('Owner sign-in required.', 401);
}

async function currentCloudSession(request: Request, env: WorkerEnv): Promise<CloudSession | null> {
  return cloudSession(env, cookieMap(request).get(USER_SESSION_COOKIE) || '');
}

async function requireCloudSession(request: Request, env: WorkerEnv): Promise<CloudSession> {
  const session = await currentCloudSession(request, env);
  if (!session) throw new HttpError('Sign in to your Fleeterbase workspace.', 401);
  return session;
}

const bouncieStateKey = (userId: string, name: string) => `user:${userId}:bouncie:${name}`;

async function activeBouncieTokens(env: WorkerEnv, userId: string): Promise<TokenSet> {
  const key = bouncieStateKey(userId, 'tokens'), stored = await getEncryptedState(env, key);
  if (!isTokenSet(stored)) throw new HttpError('Connect a Bouncie account first.', 409);
  if (new Date(stored.expiresAt).getTime() > Date.now() + 60_000) return stored;
  const refreshed = await refreshAccessToken(bouncieConfig(env), stored.refreshToken);
  await setEncryptedState(env, key, refreshed);
  return refreshed;
}

const gmailStateKey = (userId: string, name: string) => `user:${userId}:gmail:${name}`;

async function activeGmailTokens(env: WorkerEnv, userId: string): Promise<TokenSet> {
  const key = gmailStateKey(userId, 'tokens'), stored = await getEncryptedState(env, key);
  if (!isTokenSet(stored)) throw new HttpError('Connect a Gmail account first.', 409);
  if (new Date(stored.expiresAt).getTime() > Date.now() + 60_000) return stored;
  const refreshed = await refreshGoogleToken(googleConfig(env), stored.refreshToken);
  await setEncryptedState(env, key, refreshed);
  return refreshed;
}

function providerKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(item => /^((imei)|(vin)):[A-Za-z0-9-]+$/.test(item)))];
}

async function handleSession(request: Request, env: WorkerEnv, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/session') return null;
  if (request.method === 'GET') return json({ authenticated: await sessionAuthenticated(request, env) });
  if (!sameOrigin(request)) throw new HttpError('Cross-origin request blocked.', 403);
  if (request.method === 'DELETE') {
    await clearSession(env, cookieMap(request).get(SESSION_COOKIE) || '');
    return json({ authenticated: false }, 200, { 'set-cookie': clearSessionCookie() });
  }
  if (request.method !== 'POST') throw new HttpError('Method not allowed.', 405);
  if (!env.FLEETERBASE_OWNER_EMAIL || !env.FLEETERBASE_OWNER_PASSWORD) {
    throw new HttpError('Owner sign-in is not configured.', 503);
  }
  const remote = request.headers.get('cf-connecting-ip') || 'unknown', attempt = await getLoginAttempt(env, remote), now = Date.now();
  if (attempt && attempt.blockedUntil > now) throw new HttpError('Too many sign-in attempts. Try again later.', 429);
  const value = objectValue(await boundedJson(request, 10_000));
  const email = String(value.email || '').trim().toLowerCase(), password = String(value.password || '');
  const [emailOk, passwordOk] = await Promise.all([
    secureEqual(email, env.FLEETERBASE_OWNER_EMAIL.toLowerCase()),
    secureEqual(password, env.FLEETERBASE_OWNER_PASSWORD),
  ]);
  if (!emailOk || !passwordOk) {
    await recordLoginFailure(env, remote, attempt);
    throw new HttpError('Email or password is incorrect.', 401);
  }
  await clearLoginAttempt(env, remote);
  const token = await createSession(env);
  return json({ authenticated: true }, 200, { 'set-cookie': setSessionCookie(token) });
}

async function handleCloudAuth(request: Request, env: WorkerEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/auth/')) return null;
  if (url.pathname === '/api/auth/session' && request.method === 'GET') {
    const session = await currentCloudSession(request, env);
    if (!session) return json({ authenticated: false });
    return json({ authenticated: true, email: session.email, workspace: await workspaceForUser(env, session.userId) });
  }
  if (!sameOrigin(request)) throw new HttpError('Cross-origin request blocked.', 403);
  if (url.pathname === '/api/auth/session' && request.method === 'DELETE') {
    await clearUserSession(env, cookieMap(request).get(USER_SESSION_COOKIE) || '');
    return json({ authenticated: false }, 200, { 'set-cookie': clearUserSessionCookie() });
  }
  if (request.method !== 'POST') throw new HttpError('Method not allowed.', 405);
  const body = objectValue(await boundedJson(request, url.pathname === '/api/auth/register' ? 850_000 : 20_000));
  const email = normalizeEmail(body.email), password = String(body.password || '');
  if (!validEmail(email)) throw new HttpError('Enter a valid email address.', 400);
  if (password.length < 10 || password.length > 128) throw new HttpError('Password must be 10 to 128 characters.', 400);
  const attemptKey = await loginAttemptKey(request, email), attempt = await loginAttempt(env, attemptKey), now = Date.now();
  if (attempt && attempt.blockedUntil > now) throw new HttpError('Too many attempts. Try again later.', 429);

  if (url.pathname === '/api/auth/register') {
    const workspace = validateWorkspace(body.workspace);
    if (!workspace) throw new HttpError('Workspace data is invalid or too large.', 400);
    if (await userByEmail(env, email)) throw new HttpError('An account with this email already exists.', 409);
    let account;
    try { account = await createCloudAccount(env, email, password, workspace); }
    catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) throw new HttpError('An account with this email already exists.', 409);
      throw error;
    }
    await clearUserLoginAttempt(env, attemptKey);
    const token = await createUserSession(env, account.userId);
    return json({ authenticated: true, email, workspace: await workspaceForUser(env, account.userId) }, 201, { 'set-cookie': setUserSessionCookie(token) });
  }

  if (url.pathname === '/api/auth/login') {
    const user = await userByEmail(env, email);
    const valid = user
      ? await passwordMatches(password, user.password_hash, user.password_salt, user.password_iterations)
      : (await passwordRecord(password), false);
    if (!user || !valid) {
      await recordUserLoginFailure(env, attemptKey, attempt);
      throw new HttpError('Email or password is incorrect.', 401);
    }
    await clearUserLoginAttempt(env, attemptKey);
    const token = await createUserSession(env, user.id);
    return json({ authenticated: true, email, workspace: await workspaceForUser(env, user.id) }, 200, { 'set-cookie': setUserSessionCookie(token) });
  }
  throw new HttpError('API route not found.', 404);
}

async function handleCloudWorkspace(request: Request, env: WorkerEnv, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/workspace') return null;
  const session = await requireCloudSession(request, env);
  if (request.method === 'GET') return json({ workspace: await workspaceForUser(env, session.userId) });
  if (request.method !== 'PUT') throw new HttpError('Method not allowed.', 405);
  if (!sameOrigin(request)) throw new HttpError('Cross-origin request blocked.', 403);
  const body = objectValue(await boundedJson(request, 850_000)), workspace = validateWorkspace(body.workspace), version = Number(body.version);
  if (!workspace || !Number.isInteger(version) || version < 1) throw new HttpError('Workspace data or revision is invalid.', 400);
  if (stripeConfigured(env) && workspace.vehicles.length > 3 && !hasProAccess(await billingForUser(env, session.userId))) {
    throw new HttpError('Upgrade to Pro to manage more than three vehicles.', 402);
  }
  const saved = await saveWorkspace(env, session.userId, workspace, version);
  if (!saved) {
    const current = await workspaceForUser(env, session.userId);
    return json({ error: 'Workspace changed on another device.', workspace: current }, 409);
  }
  return json({ saved: true, ...saved });
}

async function handleWebhook(request: Request, env: WorkerEnv, ctx: ExecutionContext, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/bouncie/webhook') return null;
  if (request.method !== 'POST') throw new HttpError('Method not allowed.', 405);
  if (!configuredForBouncie(env)) throw new HttpError('Bouncie is not configured.', 503);
  const supplied = request.headers.get('x-bouncie-authorization') || request.headers.get('authorization') || '';
  if (!await secureEqual(supplied, env.BOUNCIE_WEBHOOK_KEY || '')) throw new HttpError('Webhook authorization failed.', 401);
  const rawValue = await boundedJson(request, 2_000_000), raw = JSON.stringify(rawValue);
  const result = await recordWebhook(env, normalizeWebhook(rawValue, raw));
  ctx.waitUntil(pruneReceipts(env));
  return json({ accepted: true, ...result });
}

async function handleGmail(request: Request, env: WorkerEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/gmail/')) return null;
  const session = await requireCloudSession(request, env), tokensKey = gmailStateKey(session.userId, 'tokens');
  const statusKey = gmailStateKey(session.userId, 'status'), pendingKey = gmailStateKey(session.userId, 'oauth-pending');
  if (request.method !== 'GET' && !sameOrigin(request)) throw new HttpError('Cross-origin request blocked.', 403);
  if (request.method === 'GET' && url.pathname === '/api/gmail/status') {
    const tokens = await getEncryptedState(env, tokensKey), status = stateObject(await getState(env, statusKey));
    return json({ ...status, configured: configuredForGmail(env), connected: isTokenSet(tokens) });
  }
  if (request.method === 'GET' && url.pathname === '/api/gmail/connect') {
    if (!configuredForGmail(env)) throw new HttpError('Add the Google OAuth secrets before connecting Gmail.', 503);
    const pending = createGoogleOAuthRequest(googleConfig(env));
    await setEncryptedState(env, pendingKey, pending);
    return redirect(pending.url);
  }
  if (request.method === 'GET' && url.pathname === '/api/gmail/callback') {
    const pending = await getEncryptedState(env, pendingKey), code = url.searchParams.get('code') || '', state = url.searchParams.get('state') || '';
    const fresh = isOAuthRequest(pending) && Date.now() - new Date(pending.createdAt).getTime() < 10 * 60 * 1000;
    if (!fresh || !code || !await secureEqual(state, pending.state)) return redirect(`${env.PUBLIC_ORIGIN}/?gmail=error`);
    try {
      const tokens = await exchangeGoogleCode(googleConfig(env), { code, verifier: pending.verifier });
      const profile = await fetchGmailProfile(tokens.accessToken);
      await Promise.all([
        setEncryptedState(env, tokensKey, tokens),
        setState(env, statusKey, { email: profile.email, connectedAt: new Date().toISOString() }),
        deleteState(env, pendingKey),
      ]);
      return redirect(`${env.PUBLIC_ORIGIN}/?gmail=connected`);
    } catch (error) {
      console.error(JSON.stringify({ message: 'Google authorization exchange failed', error: error instanceof Error ? error.message : String(error) }));
      await deleteState(env, pendingKey);
      return redirect(`${env.PUBLIC_ORIGIN}/?gmail=error`);
    }
  }
  if (request.method === 'DELETE' && url.pathname === '/api/gmail/connection') {
    const tokens = await getEncryptedState(env, tokensKey);
    let revoked = false;
    try { if (isTokenSet(tokens)) { await revokeGoogleToken(tokens.refreshToken || tokens.accessToken); revoked = true; } }
    catch (error) { console.error(JSON.stringify({ message: 'Google token revocation failed', error: error instanceof Error ? error.message : String(error) })); }
    await Promise.all([deleteState(env, tokensKey), setState(env, statusKey, {})]);
    return json({ connected: false, revoked });
  }
  if (request.method === 'POST' && url.pathname === '/api/gmail/scan') {
    const body = objectValue(await boundedJson(request, 10_000));
    const months = Math.min(Math.max(Number(body.months || 6), 1), 24), tokens = await activeGmailTokens(env, session.userId);
    const result = await scanTuroMessages(tokens.accessToken, { afterEpoch: Math.floor(Date.now() / 1000 - months * 30 * 86400), maxResults: 100 });
    const previous = stateObject(await getState(env, statusKey));
    await setState(env, statusKey, { ...previous, lastScanAt: new Date().toISOString(), lastResultCount: result.candidates.length });
    return json(result);
  }
  throw new HttpError('API route not found.', 404);
}

async function handleBouncie(request: Request, env: WorkerEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/bouncie/')) return null;
  const session = await requireCloudSession(request, env), tokensKey = bouncieStateKey(session.userId, 'tokens'), pendingKey = bouncieStateKey(session.userId, 'oauth-pending');
  if (request.method !== 'GET' && !sameOrigin(request)) throw new HttpError('Cross-origin request blocked.', 403);
  if (request.method === 'GET' && url.pathname === '/api/bouncie/status') {
    const tokens = await getEncryptedState(env, tokensKey), mappings = await getMappings(env, session.userId), status = await latestMappedLocationStatus(env, session.userId) || {};
    return json({ ...status, configured: configuredForBouncie(env), connected: isTokenSet(tokens), mappingCount: mappings.length });
  }
  if (request.method === 'GET' && url.pathname === '/api/bouncie/connect') {
    if (!configuredForBouncie(env)) throw new HttpError('Add the Bouncie provider secrets before connecting.', 503);
    const pending = createOAuthRequest(bouncieConfig(env));
    await setEncryptedState(env, pendingKey, pending);
    return redirect(pending.url);
  }
  if (request.method === 'GET' && url.pathname === '/api/bouncie/callback') {
    const pending = await getEncryptedState(env, pendingKey), code = url.searchParams.get('code') || '', state = url.searchParams.get('state') || '';
    const fresh = isOAuthRequest(pending) && Date.now() - new Date(pending.createdAt).getTime() < 10 * 60 * 1000;
    if (!fresh || !code || !await secureEqual(state, pending.state)) return redirect(`${env.PUBLIC_ORIGIN}/?bouncie=error`);
    try {
      const tokens = await exchangeAuthorizationCode(bouncieConfig(env), { code, verifier: pending.verifier });
      await Promise.all([setEncryptedState(env, tokensKey, tokens), deleteState(env, pendingKey)]);
      return redirect(`${env.PUBLIC_ORIGIN}/?bouncie=connected`);
    } catch (error) {
      console.error(JSON.stringify({ message: 'Bouncie authorization exchange failed', error: error instanceof Error ? error.message : String(error) }));
      await deleteState(env, pendingKey);
      return redirect(`${env.PUBLIC_ORIGIN}/?bouncie=error`);
    }
  }
  if (request.method === 'DELETE' && url.pathname === '/api/bouncie/connection') {
    await deleteState(env, tokensKey);
    return json({ connected: false });
  }
  if (request.method === 'GET' && url.pathname === '/api/bouncie/vehicles') {
    const tokens = await activeBouncieTokens(env, session.userId);
    return json({ vehicles: await fetchVehicles(tokens.accessToken) });
  }
  if (request.method === 'PUT' && url.pathname === '/api/bouncie/mappings') {
    const body = objectValue(await boundedJson(request, 100_000)), rawMappings = body.mappings;
    if (!Array.isArray(rawMappings)) throw new HttpError('Mappings must be an array.', 400);
    const mappings = rawMappings.map(item => {
      const value = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
      return { vehicleId: String(value.vehicleId || '').trim(), providerKeys: providerKeys(value.providerKeys) };
    }).filter(item => item.vehicleId && item.providerKeys.length);
    if (mappings.length > 500) throw new HttpError('Too many vehicle mappings.', 400);
    const allKeys = mappings.flatMap(item => item.providerKeys);
    if (new Set(allKeys).size !== allKeys.length) throw new HttpError('Each Bouncie device can map to only one vehicle.', 400);
    await saveMappings(env, session.userId, mappings);
    return json({ mappings });
  }
  if (request.method === 'GET' && url.pathname === '/api/bouncie/locations') {
    const since = url.searchParams.get('since') || '', limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 1000), 1), 5000);
    return json({ points: await listLocations(env, session.userId, since, limit) });
  }
  throw new HttpError('API route not found.', 404);
}

async function handleBilling(request: Request, env: WorkerEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/stripe/webhook') {
    if (request.method !== 'POST') throw new HttpError('Method not allowed.', 405);
    if (!stripeConfigured(env)) throw new HttpError('Stripe is not configured.', 503);
    const signature = request.headers.get('stripe-signature') || '', raw = await boundedText(request, 1_000_000);
    let event: Stripe.Event;
    try { event = await stripeClient(env).webhooks.constructEventAsync(raw, signature, env.STRIPE_WEBHOOK_SECRET || ''); }
    catch { throw new HttpError('Stripe webhook signature verification failed.', 400); }
    if (await webhookProcessed(env, event.id)) return json({ received: true, duplicate: true });
    const stripe = stripeClient(env);
    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      await saveSubscription(env, event.data.object as Stripe.Subscription);
    } else if (event.type === 'checkout.session.completed') {
      const checkout = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = typeof checkout.subscription === 'string' ? checkout.subscription : checkout.subscription?.id;
      if (subscriptionId) await saveSubscription(env, await stripe.subscriptions.retrieve(subscriptionId));
    }
    await markWebhookProcessed(env, event);
    return json({ received: true });
  }
  if (!url.pathname.startsWith('/api/billing/')) return null;
  const session = await requireCloudSession(request, env);
  if (request.method !== 'GET' && !sameOrigin(request)) throw new HttpError('Cross-origin request blocked.', 403);
  const billing = await billingForUser(env, session.userId), pro = hasProAccess(billing);
  if (request.method === 'GET' && url.pathname === '/api/billing/status') {
    return json({ configured: stripeConfigured(env), plan: pro ? 'pro' : 'free', pro, status: billing?.status || 'free',
      customerId: billing?.stripe_customer_id || null,
      currentPeriodEnd: billing?.current_period_end ? billing.current_period_end * 1000 : null,
      cancelAtPeriodEnd: Boolean(billing?.cancel_at_period_end) });
  }
  if (request.method !== 'POST') throw new HttpError('Method not allowed.', 405);
  if (!stripeConfigured(env)) throw new HttpError('Stripe billing is not configured yet.', 503);
  const stripe = stripeClient(env);
  if (url.pathname === '/api/billing/checkout') {
    if (pro) throw new HttpError('This workspace already has Pro access.', 409);
    let customerId = billing?.stripe_customer_id || '';
    if (!customerId) {
      const customer = await stripe.customers.create({ email: session.email, metadata: { fleeterbase_user_id: session.userId } }, { idempotencyKey: `fleeterbase-customer-${session.userId}` });
      customerId = customer.id;
      await saveStripeCustomer(env, session.userId, customerId);
    }
    const checkout = await stripe.checkout.sessions.create({ mode: 'subscription', customer: customerId,
      client_reference_id: session.userId, line_items: [{ price: env.STRIPE_PRO_PRICE_ID || '', quantity: 1 }],
      allow_promotion_codes: true, success_url: `${env.PUBLIC_ORIGIN}/?billing=success`, cancel_url: `${env.PUBLIC_ORIGIN}/?billing=canceled`,
      subscription_data: { metadata: { fleeterbase_user_id: session.userId } } });
    if (!checkout.url) throw new Error('Stripe did not return a checkout URL.');
    return json({ url: checkout.url });
  }
  if (url.pathname === '/api/billing/portal') {
    if (!billing?.stripe_customer_id) throw new HttpError('Start a Pro subscription before opening billing management.', 409);
    const portal = await stripe.billingPortal.sessions.create({ customer: billing.stripe_customer_id, return_url: `${env.PUBLIC_ORIGIN}/?billing=return` });
    return json({ url: portal.url });
  }
  throw new HttpError('API route not found.', 404);
}

async function api(request: Request, env: WorkerEnv, ctx: ExecutionContext, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, environment: env.ENVIRONMENT, gmailConfigured: configuredForGmail(env), bouncieConfigured: configuredForBouncie(env), stripeConfigured: stripeConfigured(env) });
  return await handleCloudAuth(request, env, url)
    || await handleCloudWorkspace(request, env, url)
    || await handleSession(request, env, url)
    || await handleWebhook(request, env, ctx, url)
    || await handleBilling(request, env, url)
    || await handleGmail(request, env, url)
    || await handleBouncie(request, env, url);
}

function secureAssetResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('content-security-policy', CSP);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.hostname === 'www.fleeterbase.com') return new Response(null, { status: 301, headers: { location: `https://fleeterbase.com${url.pathname}${url.search}` } });
      if (url.hostname === 'fleeterbase.com' && url.protocol !== 'https:') return new Response(null, { status: 301, headers: { location: `https://fleeterbase.com${url.pathname}${url.search}` } });
      const response = await api(request, env, ctx, url);
      if (response) return response;
      if (url.pathname.startsWith('/api/')) throw new HttpError('API route not found.', 404);
      return secureAssetResponse(await env.ASSETS.fetch(request));
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) console.error(JSON.stringify({ message: 'request failed', method: request.method, path: url.pathname, status, error: error instanceof Error ? error.message : String(error) }));
      return json({ error: status < 500 && error instanceof Error ? error.message : 'Unexpected server error.' }, status);
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
