import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const pageNames = new Map([
  ["/", "Home"],
  ["/music", "Music"],
  ["/videos", "Videos"],
  ["/projects", "Projects"],
  ["/support", "Support"],
]);
const devices = new Set(["desktop", "tablet", "mobile"]);
const sessionPattern = /^[a-f0-9-]{36}$/i;
const sourcePattern = /^[a-z0-9.-]{1,120}$/i;

function utcDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function addCount(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function ranked(map, keyName, valueName = "views") {
  return [...map.entries()]
    .map(([key, value]) => ({ [keyName]: key, [valueName]: value }))
    .sort((a, b) => b[valueName] - a[valueName] || String(a[keyName]).localeCompare(String(b[keyName])));
}

export function normalizeTrafficSource(value) {
  const source = String(value || "direct").toLowerCase();
  if (source === "internal" || source === "broadwaypixels.com" || source.endsWith(".broadwaypixels.com")) return "internal";
  return source;
}

export function validatePageView(input) {
  const path = String(input?.path || "");
  const sessionId = String(input?.sessionId || "");
  const device = String(input?.device || "");
  const source = normalizeTrafficSource(input?.source);

  if (!pageNames.has(path)) return { ok: false, message: "Unknown page." };
  if (!sessionPattern.test(sessionId)) return { ok: false, message: "Invalid session." };
  if (!devices.has(device)) return { ok: false, message: "Invalid device." };
  if (!["direct", "internal"].includes(source) && !sourcePattern.test(source)) return { ok: false, message: "Invalid source." };

  return { ok: true, event: { path, sessionId, device, source } };
}

export function summarizePageViews(events, days = 30, now = new Date()) {
  const safeDays = Math.min(90, Math.max(1, Number(days) || 30));
  const nowTime = now.getTime();
  const startTime = nowTime - safeDays * 24 * 60 * 60 * 1000;
  const today = utcDay(now);
  const daily = new Map();
  const pages = new Map();
  const sources = new Map();
  const deviceCounts = new Map();
  const sessions = new Set();
  const liveSessions = new Set();
  let todayViews = 0;

  for (let index = safeDays - 1; index >= 0; index -= 1) {
    const day = new Date(nowTime - index * 24 * 60 * 60 * 1000);
    daily.set(utcDay(day), { views: 0, sessions: new Set() });
  }

  const filtered = events.filter((event) => {
    const timestamp = Date.parse(event.timestamp);
    return Number.isFinite(timestamp) && timestamp >= startTime && timestamp <= nowTime + 60_000;
  });

  filtered.forEach((event) => {
    const timestamp = Date.parse(event.timestamp);
    const day = utcDay(timestamp);
    const dayRecord = daily.get(day);
    if (dayRecord) {
      dayRecord.views += 1;
      dayRecord.sessions.add(event.sessionId);
    }
    sessions.add(event.sessionId);
    if (nowTime - timestamp <= 30 * 60 * 1000) liveSessions.add(event.sessionId);
    if (day === today) todayViews += 1;
    addCount(pages, event.path);
    addCount(sources, normalizeTrafficSource(event.source));
    addCount(deviceCounts, event.device);
  });

  return {
    rangeDays: safeDays,
    totals: {
      pageViews: filtered.length,
      sessions: sessions.size,
      todayViews,
      liveSessions: liveSessions.size,
    },
    daily: [...daily.entries()].map(([date, value]) => ({ date, views: value.views, sessions: value.sessions.size })),
    pages: ranked(pages, "path").map((item) => ({ ...item, name: pageNames.get(item.path) || item.path })),
    sources: ranked(sources, "source"),
    devices: ranked(deviceCounts, "device"),
    generatedAt: now.toISOString(),
  };
}

export class AnalyticsStore {
  constructor(directory) {
    this.directory = directory;
    this.writeQueue = Promise.resolve();
  }

  record(event, now = new Date()) {
    const stored = { ...event, timestamp: now.toISOString() };
    const filename = `${stored.timestamp.slice(0, 7)}.ndjson`;
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      await appendFile(join(this.directory, filename), `${JSON.stringify(stored)}\n`, { encoding: "utf8", mode: 0o600 });
    });
    return this.writeQueue;
  }

  async stats(days = 30, now = new Date()) {
    await this.writeQueue;
    let files = [];
    try {
      files = (await readdir(this.directory)).filter((file) => /^\d{4}-\d{2}\.ndjson$/.test(file)).sort().slice(-4);
    } catch (error) {
      if (error.code === "ENOENT") return summarizePageViews([], days, now);
      throw error;
    }

    const contents = await Promise.all(files.map((file) => readFile(join(this.directory, file), "utf8")));
    const events = contents.flatMap((content) => content.split("\n").filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    }));
    return summarizePageViews(events, days, now);
  }
}
