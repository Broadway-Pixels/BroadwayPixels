CREATE TABLE IF NOT EXISTS bouncie_user_mappings (
  user_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, provider_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bouncie_user_mappings_vehicle
  ON bouncie_user_mappings(user_id, vehicle_id);
