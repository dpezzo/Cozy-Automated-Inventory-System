-- Per-vendor opt-in: when one vendor row matches SEVERAL Miva products that share the
-- same identifier (e.g. two product codes carrying one MPN), update every one of them
-- with the same vendor quantity instead of blocking the row as "BLOCKED AMBIGUOUS MIVA
-- KEY". Each product still gets its own row and is flagged SHARED_MIVA_KEY for review.
--
-- 0 (the default) keeps the original behavior. Enabled for FieldSheer/MobileWarming
-- (Cale, 2026-11-23).
ALTER TABLE vendor_configs ADD COLUMN update_all_on_shared_key INTEGER NOT NULL DEFAULT 0;
UPDATE vendor_configs SET update_all_on_shared_key = 1 WHERE vendor_key = 'fieldsheer';
