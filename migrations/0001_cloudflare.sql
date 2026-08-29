PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tickets (
  ticket_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  project TEXT NOT NULL,
  topic TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  confirmation_sent INTEGER NOT NULL DEFAULT 0,
  notification_email_id TEXT NOT NULL DEFAULT '',
  confirmation_email_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tickets_created_at_idx ON tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS tickets_status_created_at_idx ON tickets(status, created_at DESC);

CREATE TABLE IF NOT EXISTS ticket_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  email_id TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ticket_replies_ticket_sent_idx ON ticket_replies(ticket_id, sent_at);

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  session_id TEXT NOT NULL,
  device TEXT NOT NULL,
  source TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS analytics_timestamp_idx ON analytics_events(timestamp);
CREATE INDEX IF NOT EXISTS analytics_path_timestamp_idx ON analytics_events(path, timestamp);
CREATE INDEX IF NOT EXISTS analytics_session_timestamp_idx ON analytics_events(session_id, timestamp);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
