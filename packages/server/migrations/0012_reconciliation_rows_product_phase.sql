-- Stores the vendor file's own lifecycle/phase text (e.g. Gobi's "Product Phase":
-- Active / End of Life (EOL) / Discontinued) on each reconciliation row so Run
-- Review can show it. NULL for every vendor without a phase column, for Miva-only
-- rows, and for every run created before this migration (never backfilled: the
-- original value isn't recoverable from the stored row).
ALTER TABLE reconciliation_rows ADD COLUMN product_phase TEXT;
