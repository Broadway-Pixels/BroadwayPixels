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

function ticketFromRow(row) {
  if (!row) return null;
  return {
    ticketId: row.ticket_id,
    name: row.name,
    email: row.email,
    project: row.project,
    topic: row.topic,
    message: row.message,
    link: row.link,
    confirmationSent: Boolean(row.confirmation_sent),
    notificationEmailId: row.notification_email_id,
    confirmationEmailId: row.confirmation_email_id,
    status: row.status === "archived" ? "archived" : "open",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    replyCount: Number(row.reply_count || 0),
    lastRepliedAt: row.last_replied_at || "",
  };
}

export class D1Store {
  constructor(database) {
    this.database = database;
  }

  async recordTicket(ticket, now = new Date()) {
    const timestamp = now.toISOString();
    await this.database.prepare(`
      INSERT INTO tickets (
        ticket_id, name, email, project, topic, message, link, confirmation_sent,
        notification_email_id, confirmation_email_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
      ON CONFLICT(ticket_id) DO NOTHING
    `).bind(
      ticket.ticketId, ticket.name, ticket.email, ticket.project, ticket.topic, ticket.message,
      ticket.link || "", ticket.confirmationSent ? 1 : 0, ticket.notificationEmailId || "",
      ticket.confirmationEmailId || "", timestamp, timestamp,
    ).run();
  }

  async listTickets(limit = 100) {
    const safeLimit = Math.min(250, Math.max(1, Number(limit) || 100));
    const result = await this.database.prepare(`
      SELECT tickets.*,
        (SELECT COUNT(*) FROM ticket_replies WHERE ticket_replies.ticket_id = tickets.ticket_id) AS reply_count,
        (SELECT MAX(sent_at) FROM ticket_replies WHERE ticket_replies.ticket_id = tickets.ticket_id) AS last_replied_at
      FROM tickets ORDER BY created_at DESC LIMIT ?
    `).bind(safeLimit).all();
    return result.results.map(ticketFromRow);
  }

  async getTicket(ticketId) {
    return ticketFromRow(await this.database.prepare("SELECT * FROM tickets WHERE ticket_id = ?").bind(ticketId).first());
  }

  async archiveTicket(ticketId, archived, now = new Date()) {
    const result = await this.database.prepare("UPDATE tickets SET status = ?, updated_at = ? WHERE ticket_id = ?")
      .bind(archived ? "archived" : "open", now.toISOString(), ticketId).run();
    return result.meta.changes > 0;
  }

  async recordReply(ticketId, reply, now = new Date()) {
    const timestamp = now.toISOString();
    const results = await this.database.batch([
      this.database.prepare("INSERT INTO ticket_replies (ticket_id, message, email_id, sent_at) VALUES (?, ?, ?, ?)")
        .bind(ticketId, String(reply.message), String(reply.emailId || ""), timestamp),
      this.database.prepare("UPDATE tickets SET updated_at = ? WHERE ticket_id = ?").bind(timestamp, ticketId),
    ]);
    return results.every((result) => result.success);
  }

  async removeTicket(ticketId) {
    const result = await this.database.prepare("DELETE FROM tickets WHERE ticket_id = ?").bind(ticketId).run();
    return result.meta.changes > 0;
  }

  async recordPageView(event, now = new Date()) {
    await this.database.prepare("INSERT INTO analytics_events (path, session_id, device, source, timestamp) VALUES (?, ?, ?, ?, ?)")
      .bind(event.path, event.sessionId, event.device, event.source, now.toISOString()).run();
  }

  async stats(days = 30, now = new Date()) {
    const safeDays = Math.min(90, Math.max(1, Number(days) || 30));
    const nowTime = now.getTime();
    const start = new Date(nowTime - safeDays * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(nowTime + 60_000).toISOString();
    const today = utcDay(now);
    const liveStart = new Date(nowTime - 30 * 60 * 1000).toISOString();
    const [totalsResult, dailyResult, pagesResult, sourcesResult, devicesResult] = await this.database.batch([
      this.database.prepare(`
        SELECT COUNT(*) AS page_views, COUNT(DISTINCT session_id) AS sessions,
          SUM(CASE WHEN substr(timestamp, 1, 10) = ? THEN 1 ELSE 0 END) AS today_views,
          COUNT(DISTINCT CASE WHEN timestamp >= ? THEN session_id END) AS live_sessions
        FROM analytics_events WHERE timestamp >= ? AND timestamp <= ?
      `).bind(today, liveStart, start, end),
      this.database.prepare(`SELECT substr(timestamp, 1, 10) AS date, COUNT(*) AS views, COUNT(DISTINCT session_id) AS sessions
        FROM analytics_events WHERE timestamp >= ? AND timestamp <= ? GROUP BY date ORDER BY date`).bind(start, end),
      this.database.prepare(`SELECT path, COUNT(*) AS views FROM analytics_events WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY path ORDER BY views DESC, path`).bind(start, end),
      this.database.prepare(`SELECT source, COUNT(*) AS views FROM analytics_events WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY source ORDER BY views DESC, source`).bind(start, end),
      this.database.prepare(`SELECT device, COUNT(*) AS views FROM analytics_events WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY device ORDER BY views DESC, device`).bind(start, end),
    ]);
    const totals = totalsResult.results[0] || {};
    const recordedDaily = new Map(dailyResult.results.map((row) => [row.date, { date: row.date, views: Number(row.views), sessions: Number(row.sessions) }]));
    const daily = [];
    for (let index = safeDays - 1; index >= 0; index -= 1) {
      const date = utcDay(nowTime - index * 24 * 60 * 60 * 1000);
      daily.push(recordedDaily.get(date) || { date, views: 0, sessions: 0 });
    }
    return {
      rangeDays: safeDays,
      totals: {
        pageViews: Number(totals.page_views || 0), sessions: Number(totals.sessions || 0),
        todayViews: Number(totals.today_views || 0), liveSessions: Number(totals.live_sessions || 0),
      },
      daily,
      pages: pagesResult.results.map((row) => ({ path: row.path, views: Number(row.views), name: pageNames.get(row.path) || row.path })),
      sources: sourcesResult.results.map((row) => ({ source: row.source, views: Number(row.views) })),
      devices: devicesResult.results.map((row) => ({ device: row.device, views: Number(row.views) })),
      generatedAt: now.toISOString(),
    };
  }

  async rateLimited(key, maxAttempts, windowMs, now = Date.now()) {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const row = await this.database.prepare(`
      INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
        window_start = excluded.window_start RETURNING count
    `).bind(key, windowStart).first();
    return Number(row?.count || 1) > maxAttempts;
  }

  async cleanupRateLimits(now = Date.now()) {
    await this.database.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(now - 24 * 60 * 60 * 1000).run();
  }
}
