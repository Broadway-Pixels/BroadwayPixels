import { Buffer } from 'node:buffer';
import type { LocationPoint, NormalizedWebhook } from '../server/bouncie.mjs';

export type WorkerEnv = Env & {
  FLEETERBASE_OWNER_EMAIL: string;
  FLEETERBASE_OWNER_PASSWORD: string;
  FLEETERBASE_TOKEN_ENCRYPTION_KEY: string;
  BOUNCIE_CLIENT_ID?: string;
  BOUNCIE_CLIENT_SECRET?: string;
  BOUNCIE_WEBHOOK_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRO_PRICE_ID?: string;
};

type EncryptedEnvelope = { version: 1; iv: string; data: string };
type MappingRow = { provider_key: string; vehicle_id: string };
type LocationRow = {
  id: string;
  event_id: string;
  provider_keys: string;
  latitude: number;
  longitude: number;
  speed: number;
  address: string;
  recorded_at: string;
  source: string;
  event_type: string;
};

const nowIso = () => new Date().toISOString();

async function encryptionKey(env: WorkerEnv): Promise<CryptoKey> {
  const bytes = Buffer.from(env.FLEETERBASE_TOKEN_ENCRYPTION_KEY || '', 'base64');
  if (bytes.byteLength !== 32) throw new Error('FLEETERBASE_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function isEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<EncryptedEnvelope>;
  return item.version === 1 && typeof item.iv === 'string' && typeof item.data === 'string';
}

export async function setState(env: WorkerEnv, key: string, value: unknown): Promise<void> {
  await env.DB.prepare(`INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(key, JSON.stringify(value), nowIso()).run();
}

export async function getState(env: WorkerEnv, key: string): Promise<unknown | null> {
  const value = await env.DB.prepare('SELECT value FROM app_state WHERE key = ?').bind(key).first<string>('value');
  if (value === null) return null;
  try { return JSON.parse(value); }
  catch { throw new Error(`Stored state ${key} is invalid.`); }
}

export async function deleteState(env: WorkerEnv, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM app_state WHERE key = ?').bind(key).run();
}

export async function setEncryptedState(env: WorkerEnv, key: string, value: unknown): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(env), encoded);
  await setState(env, key, { version: 1, iv: Buffer.from(iv).toString('base64'), data: Buffer.from(encrypted).toString('base64') });
}

export async function getEncryptedState(env: WorkerEnv, key: string): Promise<unknown | null> {
  const envelope = await getState(env, key);
  if (envelope === null) return null;
  if (!isEnvelope(envelope)) throw new Error(`Encrypted state ${key} has an invalid envelope.`);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64') },
    await encryptionKey(env),
    Buffer.from(envelope.data, 'base64'),
  );
  try { return JSON.parse(new TextDecoder().decode(decrypted)); }
  catch { throw new Error(`Encrypted state ${key} is invalid.`); }
}

export async function createSession(env: WorkerEnv): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Buffer.from(bytes).toString('base64url');
  const idHash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const now = Date.now(), expiresAt = now + 12 * 60 * 60 * 1000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM owner_sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('INSERT INTO owner_sessions (id_hash, expires_at, created_at) VALUES (?, ?, ?)').bind(idHash, expiresAt, now),
  ]);
  return token;
}

async function sessionHash(token: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest('SHA-256', Buffer.from(token, 'base64url'))).toString('hex');
}

export async function validSession(env: WorkerEnv, token: string): Promise<boolean> {
  if (!token || token.length > 100) return false;
  const exists = await env.DB.prepare('SELECT 1 AS valid FROM owner_sessions WHERE id_hash = ? AND expires_at > ?')
    .bind(await sessionHash(token), Date.now()).first<number>('valid');
  return exists === 1;
}

export async function clearSession(env: WorkerEnv, token: string): Promise<void> {
  if (!token || token.length > 100) return;
  await env.DB.prepare('DELETE FROM owner_sessions WHERE id_hash = ?').bind(await sessionHash(token)).run();
}

export async function getLoginAttempt(env: WorkerEnv, remote: string): Promise<{ failures: number; firstAt: number; blockedUntil: number } | null> {
  const row = await env.DB.prepare('SELECT failures, first_at, blocked_until FROM login_attempts WHERE remote_address = ?').bind(remote)
    .first<{ failures: number; first_at: number; blocked_until: number }>();
  return row ? { failures: row.failures, firstAt: row.first_at, blockedUntil: row.blocked_until } : null;
}

export async function recordLoginFailure(env: WorkerEnv, remote: string, previous: { failures: number; firstAt: number } | null): Promise<void> {
  const now = Date.now(), continuing = previous && previous.firstAt > now - 15 * 60 * 1000;
  const failures = continuing ? previous.failures + 1 : 1, firstAt = continuing ? previous.firstAt : now;
  const blockedUntil = failures >= 5 ? now + 15 * 60 * 1000 : 0;
  await env.DB.prepare(`INSERT INTO login_attempts (remote_address, failures, first_at, blocked_until) VALUES (?, ?, ?, ?)
    ON CONFLICT(remote_address) DO UPDATE SET failures = excluded.failures, first_at = excluded.first_at, blocked_until = excluded.blocked_until`)
    .bind(remote, failures, firstAt, blockedUntil).run();
}

export async function clearLoginAttempt(env: WorkerEnv, remote: string): Promise<void> {
  await env.DB.prepare('DELETE FROM login_attempts WHERE remote_address = ?').bind(remote).run();
}

export async function getMappings(env: WorkerEnv, userId: string): Promise<Array<{ vehicleId: string; providerKeys: string[] }>> {
  const rows = await env.DB.prepare(`SELECT provider_key, vehicle_id FROM bouncie_user_mappings
    WHERE user_id = ? ORDER BY vehicle_id, provider_key`).bind(userId).all<MappingRow>();
  const grouped = new Map<string, string[]>();
  for (const row of rows.results) grouped.set(row.vehicle_id, [...(grouped.get(row.vehicle_id) || []), row.provider_key]);
  return [...grouped].map(([vehicleId, providerKeys]) => ({ vehicleId, providerKeys }));
}

export async function saveMappings(env: WorkerEnv, userId: string, mappings: Array<{ vehicleId: string; providerKeys: string[] }>): Promise<void> {
  const statements: D1PreparedStatement[] = [env.DB.prepare('DELETE FROM bouncie_user_mappings WHERE user_id = ?').bind(userId)];
  const updatedAt = nowIso();
  for (const mapping of mappings) {
    for (const key of mapping.providerKeys) statements.push(env.DB.prepare(`INSERT INTO bouncie_user_mappings
      (user_id, provider_key, vehicle_id, updated_at) VALUES (?, ?, ?, ?)`).bind(userId, key, mapping.vehicleId, updatedAt));
  }
  await env.DB.batch(statements);
}

export async function recordWebhook(env: WorkerEnv, webhook: NormalizedWebhook): Promise<{ duplicate: boolean; storedPoints: number }> {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('INSERT OR IGNORE INTO webhook_receipts (event_id, received_at) VALUES (?, ?)').bind(webhook.eventId, Date.now()),
  ];
  for (const point of webhook.points) {
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO locations
      (id, event_id, provider_keys, latitude, longitude, speed, address, recorded_at, source, event_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(point.id, webhook.eventId, JSON.stringify(point.providerKeys), point.latitude, point.longitude, point.speed, point.address, point.recordedAt, point.source, point.eventType));
  }
  statements.push(env.DB.prepare(`INSERT INTO app_state (key, value, updated_at) VALUES ('bouncie-status', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(JSON.stringify({ lastEventAt: nowIso(), lastEventType: webhook.eventType }), nowIso()));
  const results = await env.DB.batch(statements);
  const receiptInserted = Number(results[0]?.meta.changes || 0) > 0;
  const storedPoints = results.slice(1, 1 + webhook.points.length).reduce((sum, result) => sum + Number(result.meta.changes || 0), 0);
  return { duplicate: !receiptInserted, storedPoints };
}

function parseKeys(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

export async function listLocations(env: WorkerEnv, userId: string, since: string, limit: number): Promise<Array<LocationPoint & { vehicleId: string }>> {
  const rows = await env.DB.prepare(`SELECT id, event_id, provider_keys, latitude, longitude, speed, address, recorded_at, source, event_type
    FROM locations WHERE recorded_at > ? ORDER BY recorded_at DESC LIMIT ?`).bind(since || '', limit).all<LocationRow>();
  const mappings = await env.DB.prepare('SELECT provider_key, vehicle_id FROM bouncie_user_mappings WHERE user_id = ?').bind(userId).all<MappingRow>();
  const byKey = new Map(mappings.results.map(row => [row.provider_key, row.vehicle_id]));
  return rows.results.reverse().map(row => {
    const providerKeys = parseKeys(row.provider_keys), vehicleId = providerKeys.map(key => byKey.get(key)).find(Boolean);
    return vehicleId ? { id: row.id, providerKeys, vehicleId, latitude: row.latitude, longitude: row.longitude, speed: row.speed, address: row.address, recordedAt: row.recorded_at, source: row.source, eventType: row.event_type } : null;
  }).filter((point): point is LocationPoint & { vehicleId: string } => point !== null);
}

export async function latestMappedLocationStatus(env: WorkerEnv, userId: string): Promise<{ lastEventAt: string; lastEventType: string } | null> {
  const row = await env.DB.prepare(`SELECT locations.recorded_at, locations.event_type FROM locations
    JOIN bouncie_user_mappings ON bouncie_user_mappings.user_id = ?
      AND (locations.provider_keys LIKE '%"' || bouncie_user_mappings.provider_key || '"%')
    ORDER BY locations.recorded_at DESC LIMIT 1`).bind(userId).first<{ recorded_at: string; event_type: string }>();
  return row ? { lastEventAt: row.recorded_at, lastEventType: row.event_type } : null;
}

export async function pruneReceipts(env: WorkerEnv): Promise<void> {
  await env.DB.prepare('DELETE FROM webhook_receipts WHERE received_at < ?').bind(Date.now() - 90 * 86400 * 1000).run();
}
