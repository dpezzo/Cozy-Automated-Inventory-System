-- Adds the identification + side-by-side field detail a legacy comparison
-- row needs to be reviewed the same way a reconciliation row is on
-- RunReviewPage (Current/Proposed columns) instead of only a bare
-- pass/fail classification -- see legacyCompare.ts's LegacyComparisonValues.
ALTER TABLE legacy_comparison_rows ADD COLUMN item_no TEXT;
ALTER TABLE legacy_comparison_rows ADD COLUMN raw_upc TEXT;
ALTER TABLE legacy_comparison_rows ADD COLUMN our_values JSONB;
ALTER TABLE legacy_comparison_rows ADD COLUMN legacy_values JSONB;
