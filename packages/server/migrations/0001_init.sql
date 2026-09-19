-- CozyWinters Olliix Inventory Reconciliation MVP: initial schema.
-- Applied in order by src/db/migrate.ts, which tracks applied filenames in
-- the schema_migrations table so re-running setup is always safe (idempotent).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN (
    'olliix_workbook', 'miva_snapshot', 'legacy_audit', 'post_import_snapshot',
    'batch_update', 'batch_rollback', 'batch_exception', 'batch_reconciliation'
  )),
  original_filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  row_count INTEGER,
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_files_checksum ON files (kind, checksum_sha256);

CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  olliix_file_id UUID NOT NULL REFERENCES files(id),
  miva_file_id UUID NOT NULL REFERENCES files(id),
  rule_id TEXT NOT NULL,
  rule_config_hash TEXT NOT NULL,
  run_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('validating', 'normalizing', 'matching', 'calculating', 'ready', 'failed')),
  failure_reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs (created_at DESC);

CREATE TABLE IF NOT EXISTS reconciliation_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  source_row_number INTEGER,
  item_no TEXT,
  raw_upc TEXT,
  normalized_upc TEXT,
  description TEXT,
  product_code TEXT,
  match_outcome TEXT NOT NULL,
  review_class TEXT NOT NULL CHECK (review_class IN ('CLEAN', 'WARNING', 'BLOCKED', 'UNCHANGED')),
  warning_codes TEXT[] NOT NULL DEFAULT '{}',
  blocker_codes TEXT[] NOT NULL DEFAULT '{}',
  total_qty_raw TEXT,
  expected_date TEXT,
  expected_date_sources TEXT[] NOT NULL DEFAULT '{}',
  current_values JSONB NOT NULL DEFAULT '{}',
  proposed_values JSONB NOT NULL DEFAULT '{}',
  changed BOOLEAN NOT NULL DEFAULT false,
  is_eligible_for_approval BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_rows_run ON reconciliation_rows (run_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_rows_review_class ON reconciliation_rows (run_id, review_class);
CREATE INDEX IF NOT EXISTS idx_reconciliation_rows_product_code ON reconciliation_rows (run_id, product_code);

CREATE TABLE IF NOT EXISTS decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_row_id UUID NOT NULL UNIQUE REFERENCES reconciliation_rows(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'APPROVED_WARNING_ACK', 'REJECTED')),
  warnings_at_decision TEXT[] NOT NULL DEFAULT '{}',
  decided_by UUID REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  batch_id UUID,
  locked BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_decisions_run ON decisions (run_id);

CREATE TABLE IF NOT EXISTS batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id),
  update_file_id UUID REFERENCES files(id),
  rollback_file_id UUID REFERENCES files(id),
  exception_file_id UUID REFERENCES files(id),
  reconciliation_file_id UUID REFERENCES files(id),
  import_status TEXT NOT NULL DEFAULT 'GENERATED' CHECK (
    import_status IN ('GENERATED', 'DOWNLOADED', 'IMPORT_REPORTED', 'VERIFIED', 'VERIFICATION_FAILED', 'IMPORT_FAILED')
  ),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE decisions
  ADD CONSTRAINT fk_decisions_batch FOREIGN KEY (batch_id) REFERENCES batches(id);

CREATE TABLE IF NOT EXISTS legacy_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id),
  legacy_file_id UUID NOT NULL REFERENCES files(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS legacy_comparison_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_comparison_id UUID NOT NULL REFERENCES legacy_comparisons(id) ON DELETE CASCADE,
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id),
  post_import_file_id UUID NOT NULL REFERENCES files(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_import_verification_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id UUID NOT NULL REFERENCES post_import_verifications(id) ON DELETE CASCADE,
  product_code TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL')),
  reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_post_import_verification_rows_verification ON post_import_verification_rows (verification_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id);
