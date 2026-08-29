import assert from "node:assert/strict";
import test from "node:test";
import { sendFleeterbaseVerificationEmail } from "../lib/support.mjs";

test("sends a restricted Fleeterbase verification email through Resend", async () => {
  let request;
  const result = await sendFleeterbaseVerificationEmail({
    to: "host@example.com",
    verificationUrl: "https://fleeterbase.com/api/auth/verify?token=test-token",
  }, {
    RESEND_API_KEY: "re_test",
    FLEETERBASE_FROM_EMAIL: "Fleeterbase via Broadway Pixels <support@broadwaypixels.com>",
    SUPPORT_TO_EMAIL: "Media@BroadwayPixels.com",
  }, async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return Response.json({ id: "email-1" });
  });
  assert.equal(result.ok, true);
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.deepEqual(request.body.to, ["host@example.com"]);
  assert.match(request.body.html, /Verify email address/);
  assert.match(request.options.headers["Idempotency-Key"], /^fleeterbase-verification-/);
});

test("rejects verification links outside fleeterbase.com", async () => {
  const result = await sendFleeterbaseVerificationEmail({
    to: "host@example.com",
    verificationUrl: "https://example.com/api/auth/verify?token=test-token",
  }, { RESEND_API_KEY: "re_test", FLEETERBASE_FROM_EMAIL: "Fleeterbase <support@broadwaypixels.com>" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
});
