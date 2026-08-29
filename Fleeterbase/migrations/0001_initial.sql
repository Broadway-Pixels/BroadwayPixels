CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS owner_sessions (
  id_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_owner_sessions_expires ON owner_sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  remote_address TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bouncie_mappings (
  provider_key TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bouncie_mappings_vehicle ON bouncie_mappings(vehicle_id);

CREATE TABLE IF NOT EXISTS webhook_receipts (
  event_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhook_receipts_received ON webhook_receipts(received_at);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  provider_keys TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  speed REAL NOT NULL,
  address TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_locations_recorded ON locations(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_locations_event ON locations(event_id);
