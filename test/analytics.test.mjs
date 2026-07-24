import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AnalyticsStore, normalizeTrafficSource, summarizePageViews, validatePageView } from "../lib/analytics.mjs";

const validView = { path: "/projects", sessionId: "019f7c23-20f0-7fc1-a4c4-15c60685f833", device: "mobile", source: "instagram.com" };

test("validates privacy-preserving page view fields", () => {
  assert.equal(validatePageView(validView).ok, true);
  assert.equal(validatePageView({ ...validView, path: "/dashboard" }).ok, false);
  assert.equal(validatePageView({ ...validView, sessionId: "not-a-session" }).ok, false);
  assert.equal(validatePageView({ ...validView, source: "https://bad.example/path" }).ok, false);
});

test("groups Broadway Pixels hostnames as internal traffic", () => {
  assert.equal(normalizeTrafficSource("broadwaypixels.com"), "internal");
  assert.equal(normalizeTrafficSource("www.broadwaypixels.com"), "internal");
  assert.equal(normalizeTrafficSource("mail.broadwaypixels.com"), "internal");
  assert.equal(normalizeTrafficSource("l.instagram.com"), "l.instagram.com");
  assert.equal(validatePageView({ ...validView, source: "www.broadwaypixels.com" }).event.source, "internal");
});

test("summarizes page views, sessions, traffic sources, and devices", () => {
  const now = new Date("2026-07-22T18:00:00.000Z");
  const events = [
    { ...validView, timestamp: "2026-07-22T17:50:00.000Z" },
    { ...validView, path: "/", timestamp: "2026-07-22T17:55:00.000Z" },
    { ...validView, path: "/music", sessionId: "019f7c23-20f0-7fc1-a4c4-15c60685f834", device: "desktop", source: "direct", timestamp: "2026-07-21T12:00:00.000Z" },
    { ...validView, path: "/", sessionId: "019f7c23-20f0-7fc1-a4c4-15c60685f835", device: "desktop", source: "broadwaypixels.com", timestamp: "2026-07-21T13:00:00.000Z" },
    { ...validView, path: "/", sessionId: "019f7c23-20f0-7fc1-a4c4-15c60685f836", device: "desktop", source: "internal", timestamp: "2026-07-21T14:00:00.000Z" },
  ];
  const stats = summarizePageViews(events, 7, now);
  assert.deepEqual(stats.totals, { pageViews: 5, sessions: 4, todayViews: 2, liveSessions: 1 });
  assert.equal(stats.pages[0].views, 3);
  assert.deepEqual(stats.sources.find((source) => source.source === "internal"), { source: "internal", views: 2 });
  assert.equal(stats.sources.some((source) => source.source === "broadwaypixels.com"), false);
  assert.deepEqual(stats.devices, [{ device: "desktop", views: 3 }, { device: "mobile", views: 2 }]);
  assert.equal(stats.daily.length, 7);
});

test("persists monthly analytics and reads them back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "broadway-analytics-"));
  try {
    const store = new AnalyticsStore(directory);
    await store.record(validView, new Date("2026-07-22T17:50:00.000Z"));
    const stats = await store.stats(30, new Date("2026-07-22T18:00:00.000Z"));
    assert.equal(stats.totals.pageViews, 1);
    assert.equal(stats.pages[0].name, "Projects");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
