-- Widens batches.import_status so a Miva API push (pushBatchToMiva,
-- src/miva/mivaApiPush.ts) can set the batch's status directly, instead of
-- requiring a manual "Mark IMPORT_REPORTED/IMPORT_FAILED" click after every
-- push. The three new values mirror the audit_log actions the push already
-- writes (API_PUSH_SUCCEEDED / API_PUSH_FAILED / API_PUSH_PARTIAL_FAILURE)
-- so the two stay trivially in sync.
ALTER TABLE batches DROP CONSTRAINT IF EXISTS batches_import_status_check;
ALTER TABLE batches ADD CONSTRAINT batches_import_status_check CHECK (
  import_status IN (
    'GENERATED', 'DOWNLOADED', 'IMPORT_REPORTED', 'VERIFIED', 'VERIFICATION_FAILED', 'IMPORT_FAILED',
    'API_PUSH_SUCCEEDED', 'API_PUSH_FAILED', 'API_PUSH_PARTIAL_FAILURE'
  )
);

-- A rollback push never changes import_status (that field tracks the
-- "update" push / manual outcome), but Run History still needs to flag that
-- a batch was rolled back at some point.
ALTER TABLE batches ADD COLUMN rolled_back_at TIMESTAMPTZ;
