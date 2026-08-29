import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const BOUNCIE_AUTHORIZE_URL = 'https://auth.bouncie.com/dialog/authorize';
export const BOUNCIE_TOKEN_URL = 'https://auth.bouncie.com/oauth/token';
export const BOUNCIE_API_BASE = 'https://api.bouncie.dev/v1';

const text = value => String(value ?? '').trim();
const first = (...values) => values.find(value => value !== undefined && value !== null && value !== '');
const base64Url = value => Buffer.from(value).toString('base64url');

export function constantTimeMatch(actual, expected) {
  const actualBuffer = Buffer.from(text(actual));
  const expectedBuffer = Buffer.from(text(expected));
  return actualBuffer.length === expectedBuffer.length && actualBuffer.length > 0 && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createOAuthRequest(config) {
  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(48));
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = new URL(BOUNCIE_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: 'https://api.bouncie.dev/v1/',
  });
  return { state, verifier, url: url.toString(), createdAt: new Date().toISOString() };
}

async function readResponse(response) {
  const body = await response.text();
  let parsed;
  try { parsed = body ? JSON.parse(body) : {}; }
  catch { parsed = { error: body || 'Invalid provider response' }; }
  if (!response.ok) {
    const message = parsed.error_description || parsed.error || parsed.errors || `Bouncie request failed (${response.status})`;
    const error = new Error(typeof message === 'string' ? message : JSON.stringify(message));
    error.status = response.status;
    throw error;
  }
  return parsed;
}

export async function exchangeAuthorizationCode(config, { code, verifier }, fetchImpl = fetch) {
  const response = await fetchImpl(BOUNCIE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    }),
  });
  return normalizeTokens(await readResponse(response));
}

export async function refreshAccessToken(config, refreshToken, fetchImpl = fetch) {
  const response = await fetchImpl(BOUNCIE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  return normalizeTokens(await readResponse(response));
}

function normalizeTokens(payload) {
  if (!payload.access_token || !payload.refresh_token) throw new Error('Bouncie did not return complete access credentials.');
  const expiresIn = Number(payload.expires_in || 3600);
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenType: payload.token_type || 'Bearer',
    expiresAt: new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString(),
  };
}

export async function fetchVehicles(accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(`${BOUNCIE_API_BASE}/vehicles`, {
    headers: { authorization: accessToken, accept: 'application/json' },
  });
  const payload = await readResponse(response);
  const vehicles = Array.isArray(payload) ? payload : payload.vehicles || payload.data || [];
  return vehicles.map((vehicle, index) => normalizeVehicle(vehicle, index));
}

export function normalizeVehicle(vehicle, index = 0) {
  const vin = text(first(vehicle.vin, vehicle.VIN)).toUpperCase();
  const imei = text(first(vehicle.imei, vehicle.device?.imei, vehicle.deviceImei));
  return {
    providerId: text(first(vehicle.id, vehicle.vehicleId, imei, vin, index)),
    vin,
    imei,
    year: text(first(vehicle.year, vehicle.modelYear)),
    make: text(vehicle.make),
    model: text(vehicle.model),
    nickname: text(first(vehicle.nickname, vehicle.name)),
  };
}

export function providerKeys(source) {
  const data = source?.data || {};
  const vehicle = source?.vehicle || data.vehicle || {};
  const device = source?.device || data.device || vehicle.device || {};
  const vin = text(first(source?.vin, data.vin, vehicle.vin, source?.VIN, data.VIN)).toUpperCase();
  const imei = text(first(source?.imei, data.imei, vehicle.imei, device.imei, source?.deviceImei, data.deviceImei));
  return [...new Set([imei && `imei:${imei}`, vin && `vin:${vin}`].filter(Boolean))];
}

function normalizeTimestamp(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function pointFrom(payload, data, eventId, index = 0) {
  const gps = data?.gps || data?.location || payload?.gps || payload?.location || {};
  const latitude = Number(first(gps.lat, gps.latitude, data?.lat, data?.latitude, payload?.lat, payload?.latitude));
  const longitude = Number(first(gps.lon, gps.lng, gps.longitude, data?.lon, data?.lng, data?.longitude, payload?.lon, payload?.lng, payload?.longitude));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const speed = Number(first(data?.speed, data?.speedMph, gps.speed, payload?.speed, 0));
  return {
    id: index ? `${eventId}:${index}` : eventId,
    providerKeys: providerKeys({ ...payload, data }),
    latitude,
    longitude,
    speed: Number.isFinite(speed) && speed >= 0 ? speed : 0,
    address: text(first(data?.address, gps.address, payload?.address)),
    recordedAt: normalizeTimestamp(first(data?.timestamp, data?.recordedAt, gps.timestamp, payload?.timestamp, payload?.createdAt)),
    source: 'Bouncie',
    eventType: text(first(payload?.eventType, payload?.event_type, payload?.type, 'unknown')),
  };
}

export function normalizeWebhook(payload, rawBody = JSON.stringify(payload)) {
  const eventId = text(first(payload?.transactionId, payload?.transaction_id, payload?.data?.transactionId)) || createHash('sha256').update(rawBody).digest('hex');
  const items = Array.isArray(payload?.data) ? payload.data : [payload?.data || payload];
  return {
    eventId,
    eventType: text(first(payload?.eventType, payload?.event_type, payload?.type, 'unknown')),
    points: items.map((item, index) => pointFrom(payload, item, eventId, index)).filter(Boolean),
  };
}
