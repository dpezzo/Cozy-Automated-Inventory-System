-- One row per email the autopilot mailbox poller has looked at, so a message is
-- never handled twice (message_id is the email's own Message-ID header) and
-- Settings > Autopilot can show recent activity. outcome is one of:
-- REVIEWED (run created, Stage 1 report sent), HELD (safety brake tripped),
-- DUPLICATE (same vendor file already processed), REJECTED (no usable
-- attachment / unknown format / failed authentication), IGNORED (sender not
-- approved), FAILED (unexpected error). details holds brake numbers etc.
CREATE TABLE IF NOT EXISTS autopilot_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT NOT NULL UNIQUE,
  sender TEXT,
  subject TEXT,
  outcome TEXT NOT NULL,
  vendor_key TEXT,
  file_id UUID,
  run_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_autopilot_messages_created ON autopilot_messages (created_at);
-- file_id and run_id are deliberately not foreign keys: Settings > Clear Data may delete
-- those rows, and the activity history should survive that.
