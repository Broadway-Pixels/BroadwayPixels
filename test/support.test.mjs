import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedOrigin, sendSupportEmail, validateSupportSubmission } from "../lib/support.mjs";

const validSubmission = {
  name: "River Samsel",
  email: "river@example.com",
  project: "Vidioza",
  topic: "Export will not finish",
  message: "The export stays at the final step every time I try it.",
  link: "https://example.com/project/123",
  company: "",
  requestId: "019f7c23-20f0-7fc1-a4c4-15c60685f833",
};

test("validates a complete project support request", () => {
  const result = validateSupportSubmission(validSubmission);
  assert.equal(result.ok, true);
  assert.equal(result.submission.email, "river@example.com");
  assert.equal(validateSupportSubmission({ ...validSubmission, project: "KixKan" }).ok, true);
  assert.equal(validateSupportSubmission({ ...validSubmission, project: "Music" }).ok, true);
  assert.equal(validateSupportSubmission({ ...validSubmission, project: "Content" }).ok, true);
  assert.equal(validateSupportSubmission({ ...validSubmission, project: "Partnerships" }).ok, true);
  assert.equal(validateSupportSubmission({ ...validSubmission, project: "General question", topic: "Music collaboration" }).ok, true);
});

test("rejects unknown projects and short messages", () => {
  assert.equal(validateSupportSubmission({ ...validSubmission, project: "Unknown" }).ok, false);
  assert.equal(validateSupportSubmission({ ...validSubmission, project: "ResellOps" }).ok, false);
  assert.equal(validateSupportSubmission({ ...validSubmission, project: "Shop Market Deals" }).ok, false);
  assert.equal(validateSupportSubmission({ ...validSubmission, project: "Website" }).ok, false);
  assert.equal(validateSupportSubmission({ ...validSubmission, message: "Too short" }).ok, false);
});

test("silently accepts honeypot submissions without sending", () => {
  const result = validateSupportSubmission({ ...validSubmission, company: "Spam Company" });
  assert.equal(result.ok, false);
  assert.equal(result.silent, true);
});

test("allows same-origin and configured origins", () => {
  assert.equal(isAllowedOrigin({ origin: "https://broadwaypixels.com", host: "broadwaypixels.com" }), true);
  assert.equal(isAllowedOrigin({ origin: "https://preview.example.com", host: "broadwaypixels.com" }, "https://preview.example.com"), true);
  assert.equal(isAllowedOrigin({ origin: "https://attacker.example", host: "broadwaypixels.com" }), false);
});

test("sends an escaped Resend email with reply-to and idempotency", async () => {
  let request;
  const fetchMock = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ id: "email_123" }) };
  };
  const result = await sendSupportEmail(
    { ...validSubmission, topic: "Issue <script>", message: "A long enough message with <script>alert(1)</script>." },
    {
      RESEND_API_KEY: "re_test",
      SUPPORT_FROM_EMAIL: "Broadway Pixels Support <support@mail.broadwaypixels.com>",
      SUPPORT_TO_EMAIL: "Media@BroadwayPixels.com",
    },
    fetchMock,
  );

  assert.equal(result.ok, true);
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.options.headers["Idempotency-Key"], `support-${validSubmission.requestId}`);
  const body = JSON.parse(request.options.body);
  assert.equal(body.reply_to, validSubmission.email);
  assert.equal(body.to[0], "Media@BroadwayPixels.com");
  assert.match(body.html, /&lt;script&gt;/);
  assert.doesNotMatch(body.html, /<script>/);
});

test("fails safely when Resend is not configured", async () => {
  const result = await sendSupportEmail(validSubmission, {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});
