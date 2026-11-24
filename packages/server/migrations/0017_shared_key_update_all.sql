-- Per-vendor opt-in: when one vendor row matches SEVERAL Miva products that share the
-- same identifier (e.g. two product codes carrying one MPN, such as a heated cat bowl
-- and a heated dog bowl sold as separate listings of the same physical item), update
-- every one of them with the same vendor quantity instead of blocking the row as
-- "BLOCKED AMBIGUOUS MIVA KEY". Each product still gets its own row, compared against
-- its own current Miva values, and is flagged SHARED_MIVA_KEY so it needs review.
--
-- FALSE (the default) keeps the original behavior. Enabled for FieldSheer/MobileWarming
-- (Cale, 2026-11-23).
ALTER TABLE vendor_configs ADD COLUMN update_all_on_shared_key BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE vendor_configs SET update_all_on_shared_key = TRUE WHERE vendor_key = 'fieldsheer';
