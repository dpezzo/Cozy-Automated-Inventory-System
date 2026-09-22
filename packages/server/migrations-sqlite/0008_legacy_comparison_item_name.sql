-- Same provenance as item_no/raw_upc (added in 0006): the vendor file's
-- description column, null for a Miva-only row not present in the vendor
-- file. See legacyCompare.ts's itemName.
ALTER TABLE legacy_comparison_rows ADD COLUMN item_name TEXT;
