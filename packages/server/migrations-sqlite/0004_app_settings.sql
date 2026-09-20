-- Generic key/value store for small admin-tunable app config that doesn't
-- warrant its own table. Starts with the data-size alert thresholds (see
-- Repository.getDataStats/setDataSizeAlertThresholds) -- reusable for future
-- settings without another migration.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
