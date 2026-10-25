-- Opts a vendor into lifecycle-aware NLA handling (see VendorRuleConfig.
-- discontinuedThreshold in packages/shared/src/types.ts): a row the vendor's
-- file reports as End of Life / Discontinued with fewer units than this value
-- is proposed as NLA instead of IN STOCK / SOLD OUT.
--
-- NULL (the default) means "not enabled" and leaves a vendor's behavior and
-- rule_config_hash exactly as before. Only Gobi Heat is enabled so far
-- (Cale, 2026-10-25: below 10 units => NLA; 10 or more follows the normal
-- stock threshold).
ALTER TABLE vendor_configs ADD COLUMN discontinued_threshold INTEGER;

UPDATE vendor_configs SET discontinued_threshold = 10 WHERE vendor_key = 'gobi';
