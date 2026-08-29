import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

// Cloudflare Workers rejects Web Crypto PBKDF2 requests above 100,000 iterations.
export const PASSWORD_ITERATIONS = 100_000;

const encoder = new TextEncoder();
const base64 = value => Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value)).toString('base64');

async function derivePassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return base64(await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: new Uint8Array(salt).buffer,
    iterations,
  }, key, 256));
}

export async function passwordRecord(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    hash: await derivePassword(password, salt, PASSWORD_ITERATIONS),
    salt: base64(salt),
    iterations: PASSWORD_ITERATIONS,
  };
}

export async function passwordMatches(password, hash, salt, iterations) {
  const calculated = Buffer.from(await derivePassword(password, Buffer.from(salt, 'base64'), iterations), 'base64');
  const expected = Buffer.from(hash, 'base64');
  if (calculated.length !== expected.length || expected.length === 0) return false;
  return timingSafeEqual(calculated, expected);
}
