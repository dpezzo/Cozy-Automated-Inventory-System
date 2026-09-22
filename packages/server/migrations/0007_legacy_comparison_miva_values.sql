-- A legacy comparison row already records what this app calculated
-- (our_values) and what the legacy workbook recorded (legacy_values, added
-- in 0006). This adds a third reference point: what Miva already had before
-- the run (miva_values). Critical for the Miva-only orphan rows (in Miva +
-- the legacy sheet, but not the vendor file, e.g. not-yet-discontinued NLA
-- candidates) -- for those, our_values is never populated at all, so
-- miva_values is the only real value to compare against the legacy file.
-- See legacyCompare.ts's mivaValuesFrom.
ALTER TABLE legacy_comparison_rows ADD COLUMN miva_values JSONB;
