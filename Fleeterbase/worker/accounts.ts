import { Buffer } from 'node:buffer';
import { passwordMatches, passwordRecord } from '../server/password.mjs';
import type { WorkerEnv } from './store';

export { passwordMatches, passwordRecord } from '../server/password.mjs';

export const USER_SESSION_COOKIE = 'fleeterbase_session';
export const USER_SESSION_SECONDS = 7 * 24 * 60 * 60;
const MAX_WORKSPACE_BYTES = 750_000;

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  email_verified_at: number | null;
};

type SessionRow = { user_id: string; email: string };
type WorkspaceRow = { id: string; data: string; version: number; updated_at: number };

export type WorkspaceData = {
  profile: Record<string, unknown>;
  prefs: Record<string, unknown>;
  vehicles: unknown[];
  reservations: unknown[];
  tracking: unknown[];
};

export type CloudSession = { userId: string; email: string };

const encoder = new TextEncoder();

async function sha256(value: Uint8Array): Promise<string> {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(value).buffer)).toString('hex');
}

export function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateWorkspace(value: unknown): WorkspaceData | null {
  if (!plainObject(value)) return null;
  const profile = value.profile, prefs = value.prefs, vehicles = value.vehicles, reservations = value.reservations, tracking = value.tracking;
  if (!plainObject(profile) || !plainObject(prefs) || !Array.isArray(vehicles) || !Array.isArray(reservations) || !Array.isArray(tracking)) return null;
  if (vehicles.length > 2_000 || reservations.length > 20_000 || tracking.length > 25_000) return null;
  const result = { profile, prefs, vehicles, reservations, tracking };
  return encoder.encode(JSON.stringify(result)).byteLength <= MAX_WORKSPACE_BYTES ? result : null;
}

export async function createCloudAccount(env: WorkerEnv, email: string, password: string, workspace: WorkspaceData): Promise<CloudSession & { workspaceId: string; version: number }> {
  const userId = crypto.randomUUID(), workspaceId = crypto.randomUUID(), now = Date.now();
  const passwordValue = await passwordRecord(password);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO users (id, email, password_hash, password_salt, password_iterations, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(userId, email, passwordValue.hash, passwordValue.salt, passwordValue.iterations, now, now),
    env.DB.prepare(`INSERT INTO workspaces (id, owner_user_id, data, version, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)`).bind(workspaceId, userId, JSON.stringify(workspace), now, now),
  ]);
  return { userId, email, workspaceId, version: 1 };
}

export async function userByEmail(env: WorkerEnv, email: string): Promise<UserRow | null> {
  return env.DB.prepare(`SELECT id, email, password_hash, password_salt, password_iterations, email_verified_at FROM users WHERE email = ?`)
    .bind(email).first<UserRow>();
}

export async function userById(env: WorkerEnv, userId: string): Promise<UserRow | null> {
  return env.DB.prepare(`SELECT id, email, password_hash, password_salt, password_iterations, email_verified_at FROM users WHERE id = ?`)
    .bind(userId).first<UserRow>();
}

export async function createEmailVerificationToken(env: WorkerEnv, userId: string): Promise<string | null> {
  const now = Date.now();
  const recent = await env.DB.prepare('SELECT created_at FROM email_verification_tokens WHERE user_id = ?')
    .bind(userId).first<number>('created_at');
  if (recent !== null && recent > now - 60_000) return null;
  const bytes = crypto.getRandomValues(new Uint8Array(32)), token = Buffer.from(bytes).toString('base64url');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM email_verification_tokens WHERE expires_at <= ?').bind(now),
    env.DB.prepare(`INSERT INTO email_verification_tokens (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash,
      expires_at = excluded.expires_at, created_at = excluded.created_at`)
      .bind(await sha256(bytes), userId, now + 24 * 60 * 60 * 1000, now),
  ]);
  return token;
}

export async function verifyEmailToken(env: WorkerEnv, token: string): Promise<{ userId: string; email: string } | null> {
  if (!token || token.length > 100 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const now = Date.now(), tokenHash = await sha256(Buffer.from(token, 'base64url'));
  const row = await env.DB.prepare(`SELECT users.id AS user_id, users.email FROM email_verification_tokens
    JOIN users ON users.id = email_verification_tokens.user_id
    WHERE email_verification_tokens.token_hash = ? AND email_verification_tokens.expires_at > ?`)
    .bind(tokenHash, now).first<{ user_id: string; email: string }>();
  if (!row) return null;
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?').bind(now, now, row.user_id),
    env.DB.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').bind(row.user_id),
  ]);
  return { userId: row.user_id, email: row.email };
}

export async function changeUserPassword(env: WorkerEnv, userId: string, password: string): Promise<void> {
  const passwordValue = await passwordRecord(password), now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?`)
      .bind(passwordValue.hash, passwordValue.salt, passwordValue.iterations, now, userId),
    env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(userId),
  ]);
}

export async function deleteCloudAccount(env: WorkerEnv, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM app_state WHERE key LIKE ?').bind(`user:${userId}:%`),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
}

export async function createUserSession(env: WorkerEnv, userId: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32)), token = Buffer.from(bytes).toString('base64url');
  const now = Date.now(), expiresAt = now + USER_SESSION_SECONDS * 1000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('INSERT INTO user_sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(bytes), userId, expiresAt, now),
  ]);
  return token;
}

async function tokenHash(token: string): Promise<string> {
  return sha256(Buffer.from(token, 'base64url'));
}

export async function cloudSession(env: WorkerEnv, token: string): Promise<CloudSession | null> {
  if (!token || token.length > 100) return null;
  const row = await env.DB.prepare(`SELECT user_sessions.user_id, users.email FROM user_sessions
    JOIN users ON users.id = user_sessions.user_id
    WHERE user_sessions.id_hash = ? AND user_sessions.expires_at > ?`)
    .bind(await tokenHash(token), Date.now()).first<SessionRow>();
  return row ? { userId: row.user_id, email: row.email } : null;
}

export async function clearUserSession(env: WorkerEnv, token: string): Promise<void> {
  if (!token || token.length > 100) return;
  await env.DB.prepare('DELETE FROM user_sessions WHERE id_hash = ?').bind(await tokenHash(token)).run();
}

export async function workspaceForUser(env: WorkerEnv, userId: string): Promise<{ id: string; data: WorkspaceData; version: number; updatedAt: number }> {
  const row = await env.DB.prepare('SELECT id, data, version, updated_at FROM workspaces WHERE owner_user_id = ?').bind(userId).first<WorkspaceRow>();
  if (!row) throw new Error('Workspace is missing.');
  const data = validateWorkspace(JSON.parse(row.data));
  if (!data) throw new Error('Stored workspace is invalid.');
  return { id: row.id, data, version: row.version, updatedAt: row.updated_at };
}

export async function saveWorkspace(env: WorkerEnv, userId: string, data: WorkspaceData, expectedVersion: number): Promise<{ version: number; updatedAt: number } | null> {
  const updatedAt = Date.now(), nextVersion = expectedVersion + 1;
  const result = await env.DB.prepare(`UPDATE workspaces SET data = ?, version = ?, updated_at = ?
    WHERE owner_user_id = ? AND version = ?`).bind(JSON.stringify(data), nextVersion, updatedAt, userId, expectedVersion).run();
  return Number(result.meta.changes || 0) === 1 ? { version: nextVersion, updatedAt } : null;
}

export async function loginAttempt(env: WorkerEnv, key: string): Promise<{ failures: number; firstAt: number; blockedUntil: number } | null> {
  const row = await env.DB.prepare('SELECT failures, first_at, blocked_until FROM user_login_attempts WHERE attempt_key = ?').bind(key)
    .first<{ failures: number; first_at: number; blocked_until: number }>();
  return row ? { failures: row.failures, firstAt: row.first_at, blockedUntil: row.blocked_until } : null;
}

export async function recordUserLoginFailure(env: WorkerEnv, key: string, previous: { failures: number; firstAt: number } | null): Promise<void> {
  const now = Date.now(), continuing = previous && previous.firstAt > now - 15 * 60 * 1000;
  const failures = continuing ? previous.failures + 1 : 1, firstAt = continuing ? previous.firstAt : now;
  const blockedUntil = failures >= 5 ? now + 15 * 60 * 1000 : 0;
  await env.DB.prepare(`INSERT INTO user_login_attempts (attempt_key, failures, first_at, blocked_until) VALUES (?, ?, ?, ?)
    ON CONFLICT(attempt_key) DO UPDATE SET failures = excluded.failures, first_at = excluded.first_at, blocked_until = excluded.blocked_until`)
    .bind(key, failures, firstAt, blockedUntil).run();
}

export async function clearUserLoginAttempt(env: WorkerEnv, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM user_login_attempts WHERE attempt_key = ?').bind(key).run();
}
