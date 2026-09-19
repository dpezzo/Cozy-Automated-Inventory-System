-- CozyWinters Olliix Inventory Reconciliation MVP: SQLite schema.
-- This is the default, native-Windows persistence path (no Docker/Postgres
-- required). Semantically equivalent to migrations/0001_init.sql (the
-- optional PostgreSQL path): same entities, same relationships, same
-- immutability and audit guarantees. Differences are mechanical:
--   - ids are TEXT (UUIDs generated in application code, not gen_random_uuid());
--   - array/JSON columns (warning_codes, blocker_codes, expected_date_sources,
--     current_values, proposed_values, details) are stored as TEXT holding
--     JSON, encoded/decoded by the sqliteRepository, never hand-parsed by
--     domain/reconciliation code;
--   - timestamps are TEXT ISO-8601 strings (CURRENT_TIMESTAMP);
--   - booleans are INTEGER 0/1.
-- Applied in order by src/db/sqliteMigrate.ts, tracked in schema_migrations.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  -- Valid values are enforced by the FileKind TypeScript union and the vendor
  -- registry (packages/shared/src/vendorRegistry.ts), not a DB-level CHECK,
  -- so adding a new vendor never requires a schema migration.
  kind TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  row_count INTEGER,
  uploaded_by TEXT REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_files_checksum ON files (kind, checksum_sha256);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  vendor_file_id TEXT NOT NULL REFERENCES files(id),
  miva_file_id TEXT NOT NULL REFERENCES files(id),
  rule_id TEXT NOT NULL,
  rule_config_hash TEXT NOT NULL,
  run_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('validating', 'normalizing', 'matching', 'calculating', 'ready', 'failed')),
  failure_reason TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs (created_at DESC);

CREATE TABLE IF NOT EXISTS reconciliation_rows (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  source_row_number INTEGER,
  item_no TEXT,
  raw_upc TEXT,
  normalized_upc TEXT,
  description TEXT,
  product_code TEXT,
  match_outcome TEXT NOT NULL,
  review_class TEXT NOT NULL CHECK (review_class IN ('CLEAN', 'WARNING', 'BLOCKED', 'UNCHANGED')),
  warning_codes TEXT NOT NULL DEFAULT '[]',
  blocker_codes TEXT NOT NULL DEFAULT '[]',
  total_qty_raw TEXT,
  expected_date TEXT,
  expected_date_sources TEXT NOT NULL DEFAULT '[]',
  current_values TEXT NOT NULL DEFAULT '{}',
  proposed_values TEXT NOT NULL DEFAULT '{}',
  changed INTEGER NOT NULL DEFAULT 0,
  is_eligible_for_approval INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_rows_run ON reconciliation_rows (run_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_rows_review_class ON reconciliation_rows (run_id, review_class);
CREATE INDEX IF NOT EXISTS idx_reconciliation_rows_product_code ON reconciliation_rows (run_id, product_code);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  reconciliation_row_id TEXT NOT NULL UNIQUE REFERENCES reconciliation_rows(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'APPROVED_WARNING_ACK', 'REJECTED')),
  warnings_at_decision TEXT NOT NULL DEFAULT '[]',
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  batch_id TEXT,
  locked INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_decisions_run ON decisions (run_id);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  update_file_id TEXT REFERENCES files(id),
  rollback_file_id TEXT REFERENCES files(id),
  exception_file_id TEXT REFERENCES files(id),
  reconciliation_file_id TEXT REFERENCES files(id),
  import_status TEXT NOT NULL DEFAULT 'GENERATED' CHECK (
    import_status IN ('GENERATED', 'DOWNLOADED', 'IMPORT_REPORTED', 'VERIFIED', 'VERIFICATION_FAILED', 'IMPORT_FAILED')
  ),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS legacy_comparisons (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  legacy_file_id TEXT NOT NULL REFERENCES files(id),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS legacy_comparison_rows (
  id TEXT PRIMARY KEY,
  legacy_comparison_id TEXT NOT NULL REFERENCES legacy_comparisons(id) ON DELETE CASCADE,
  source_row_number INTEGER,
  product_code TEXT,
  comparison_class TEXT NOT NULL CHECK (
    comparison_class IN ('EXACT_MATCH', 'APPROVED_DEVIATION', 'UNEXPLAINED_DIFFERENCE', 'NOT_COMPARABLE')
  ),
  deviation_id TEXT,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_legacy_comparison_rows_comparison ON legacy_comparison_rows (legacy_comparison_id);

CREATE TABLE IF NOT EXISTS post_import_verifications (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  post_import_file_id TEXT NOT NULL REFERENCES files(id),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS post_import_verification_rows (
  id TEXT PRIMARY KEY,
  verification_id TEXT NOT NULL REFERENCES post_import_verifications(id) ON DELETE CASCADE,
  product_code TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL')),
  reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_post_import_verification_rows_verification ON post_import_verification_rows (verification_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id);

-- Session store for express-session (see src/db/sqliteSessionStore.ts).
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
