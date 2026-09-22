-- Widens batches.import_status so a Miva API push (pushBatchToMiva,
-- src/miva/mivaApiPush.ts) can set the batch's status directly, instead of
-- requiring a manual "Mark IMPORT_REPORTED/IMPORT_FAILED" click after every
-- push. The three new values mirror the audit_log actions the push already
-- writes (API_PUSH_SUCCEEDED / API_PUSH_FAILED / API_PUSH_PARTIAL_FAILURE)
-- so the two stay trivially in sync.
--
-- SQLite has no ALTER TABLE ... DROP/ADD CONSTRAINT, so the CHECK is widened
-- by the standard recreate-table dance. rolled_back_at (see mivaApiPush.ts:
-- a rollback push never changes import_status, only this) is added on the
-- new table directly rather than via a separate ALTER TABLE ADD COLUMN, to
-- avoid two passes over the table in one migration.
--
-- No other table has a declared FOREIGN KEY into batches (decisions.batch_id
-- is a plain TEXT column, not a REFERENCES), so nothing else needs updating.

CREATE TABLE batches_new (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  update_file_id TEXT REFERENCES files(id),
  rollback_file_id TEXT REFERENCES files(id),
  exception_file_id TEXT REFERENCES files(id),
  reconciliation_file_id TEXT REFERENCES files(id),
  import_status TEXT NOT NULL DEFAULT 'GENERATED' CHECK (
    import_status IN (
      'GENERATED', 'DOWNLOADED', 'IMPORT_REPORTED', 'VERIFIED', 'VERIFICATION_FAILED', 'IMPORT_FAILED',
      'API_PUSH_SUCCEEDED', 'API_PUSH_FAILED', 'API_PUSH_PARTIAL_FAILURE'
    )
  ),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  rolled_back_at TEXT
);

INSERT INTO batches_new (id, run_id, update_file_id, rollback_file_id, exception_file_id, reconciliation_file_id, import_status, created_by, created_at)
SELECT id, run_id, update_file_id, rollback_file_id, exception_file_id, reconciliation_file_id, import_status, created_by, created_at
FROM batches;

DROP TABLE batches;
ALTER TABLE batches_new RENAME TO batches;
