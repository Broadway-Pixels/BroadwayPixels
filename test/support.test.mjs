import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedOrigin, sendSupportEmails, validateSupportSubmission } from "../lib/support.mjs";

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
  assert.equal(validateSupportSubmission({ ...validSubmission, project: "Pixelated" }).ok, true);
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

test("sends the support notification and branded confirmation with the ticket number", async () => {
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ id: `email_${requests.length}` }) };
  };
  const result = await sendSupportEmails(
    { ...validSubmission, topic: "Issue <script>", message: "A long enough message with <script>alert(1)</script>." },
    "B4829173056",
    {
      RESEND_API_KEY: "re_test",
      SUPPORT_FROM_EMAIL: "Broadway Pixels Support <support@mail.broadwaypixels.com>",
      SUPPORT_TO_EMAIL: "Media@BroadwayPixels.com",
    },
    fetchMock,
  );

  assert.equal(result.ok, true);
  assert.equal(result.confirmationSent, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://api.resend.com/emails");
  assert.equal(requests[0].options.headers["Idempotency-Key"], `support-admin-${validSubmission.requestId}`);
  assert.equal(requests[1].options.headers["Idempotency-Key"], `support-confirmation-${validSubmission.requestId}`);
  const notification = JSON.parse(requests[0].options.body);
  const confirmation = JSON.parse(requests[1].options.body);
  assert.equal(notification.reply_to, validSubmission.email);
  assert.equal(notification.to[0], "Media@BroadwayPixels.com");
  assert.match(notification.subject, /B4829173056/);
  assert.match(notification.html, /&lt;script&gt;/);
  assert.doesNotMatch(notification.html, /<script>/);
  assert.equal(confirmation.to[0], validSubmission.email);
  assert.equal(confirmation.reply_to, "Media@BroadwayPixels.com");
  assert.match(confirmation.subject, /B4829173056/);
  assert.match(confirmation.html, /broadway-pixels-favicon\.png/);
  assert.match(confirmation.html, /We received your message\./);
});

test("accepts the ticket if the notification sends but confirmation fails", async () => {
  let requestCount = 0;
  const result = await sendSupportEmails(validSubmission, "B4829173056", {
    RESEND_API_KEY: "re_test",
    SUPPORT_FROM_EMAIL: "Broadway Pixels Support <support@mail.broadwaypixels.com>",
  }, async () => {
    requestCount += 1;
    return requestCount === 1
      ? { ok: true, json: async () => ({ id: "email_admin" }) }
      : { ok: false, json: async () => ({ message: "failed" }) };
  });
  assert.equal(result.ok, true);
  assert.equal(result.confirmationSent, false);
});

test("fails safely when Resend is not configured", async () => {
  const result = await sendSupportEmails(validSubmission, "B4829173056", {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});
