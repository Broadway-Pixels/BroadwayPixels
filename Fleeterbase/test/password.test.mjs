import assert from 'node:assert/strict';
import test from 'node:test';
import { PASSWORD_ITERATIONS, passwordMatches, passwordRecord } from '../server/password.mjs';

test('password hashing stays within the Cloudflare Workers PBKDF2 limit', async () => {
  assert.equal(PASSWORD_ITERATIONS, 100_000);
  const record = await passwordRecord('correct horse battery staple');
  assert.equal(record.iterations, PASSWORD_ITERATIONS);
  assert.equal(await passwordMatches('correct horse battery staple', record.hash, record.salt, record.iterations), true);
  assert.equal(await passwordMatches('wrong password', record.hash, record.salt, record.iterations), false);
});
