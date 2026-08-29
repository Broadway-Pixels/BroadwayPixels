import assert from "node:assert/strict";
import test from "node:test";
import {
  clearDashboardSessionCookie,
  createDashboardSession,
  dashboardConfigured,
  dashboardSessionCookie,
  readDashboardSession,
  verifyDashboardCredentials,
  verifyDashboardSession,
} from "../worker/auth.mjs";
import { normalizeTrafficSource, validatePageView } from "../worker/store.mjs";

const env = {
  DASHBOARD_USERNAME: "broadwaypixels",
  DASHBOARD_PASSWORD: "a-strong-dashboard-password",
  DASHBOARD_SESSION_SECRET: "a-session-secret-that-is-at-least-thirty-two-characters",
};

test("Cloudflare dashboard auth signs and verifies secure sessions", async () => {
  const now = Date.parse("2026-08-29T12:00:00.000Z");
  assert.equal(dashboardConfigured(env), true);
  assert.equal(verifyDashboardCredentials({ username: env.DASHBOARD_USERNAME, password: env.DASHBOARD_PASSWORD }, env), true);
  const token = await createDashboardSession(env, now);
  assert.equal(await verifyDashboardSession(token, env, now + 1_000), true);
  assert.equal(await verifyDashboardSession(`${token}tampered`, env, now + 1_000), false);
  assert.equal(readDashboardSession(`other=value; ${dashboardSessionCookie(token)}`), token);
  assert.match(clearDashboardSessionCookie(), /Max-Age=0/);
});

test("Cloudflare analytics validation matches the existing privacy rules", () => {
  const view = {
    path: "/projects",
    sessionId: "019f7c23-20f0-7fc1-a4c4-15c60685f833",
    device: "mobile",
    source: "www.broadwaypixels.com",
  };
  assert.equal(validatePageView(view).ok, true);
  assert.equal(validatePageView(view).event.source, "internal");
  assert.equal(normalizeTrafficSource("l.instagram.com"), "l.instagram.com");
  assert.equal(validatePageView({ ...view, path: "/dashboard" }).ok, false);
});
