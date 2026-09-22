-- Adds the identification + side-by-side field detail a legacy comparison
-- row needs to be reviewed the same way a reconciliation row is on
-- RunReviewPage (Current/Proposed columns) instead of only a bare
-- pass/fail classification -- see legacyCompare.ts's LegacyComparisonValues.
-- our_values/legacy_values are JSON objects stored as TEXT, the same
-- convention 0001_init.sql already uses for reconciliation_rows'
-- current_values/proposed_values.
ALTER TABLE legacy_comparison_rows ADD COLUMN item_no TEXT;
ALTER TABLE legacy_comparison_rows ADD COLUMN raw_upc TEXT;
ALTER TABLE legacy_comparison_rows ADD COLUMN our_values TEXT;
ALTER TABLE legacy_comparison_rows ADD COLUMN legacy_values TEXT;
