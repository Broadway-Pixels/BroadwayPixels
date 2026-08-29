import assert from 'node:assert/strict';
import test from 'node:test';
import { sendVerificationEmail, verificationMessage } from '../server/verificationEmail.mjs';

test('verification email includes branded HTML, plain text, and the one-time link', async () => {
  const url = 'https://fleeterbase.com/api/auth/verify?token=test-token';
  const message = verificationMessage({ to: 'host@example.com', verificationUrl: url });
  assert.equal(message.to, 'host@example.com');
  assert.equal(message.from.email, 'noreply@fleeterbase.com');
  assert.match(message.subject, /Verify/);
  assert.match(message.text, /expires in 24 hours/);
  assert.match(message.text, /test-token/);
  assert.match(message.html, /Verify email address/);

  let sent;
  const result = await sendVerificationEmail({ fetch: async (_url, options) => { sent = JSON.parse(options.body); return Response.json({ sent: true, id: 'email-1' }); } }, 'relay-secret', { to: 'host@example.com', verificationUrl: url });
  assert.equal(sent.to, 'host@example.com');
  assert.equal(result.id, 'email-1');
});
