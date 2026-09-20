-- Adds a DB-backed vendor configuration table, replacing
-- packages/shared/src/vendorRegistry.ts's hardcoded object as the runtime
-- source of truth for per-vendor tunables (threshold, brand allowlist,
-- timezone, match strategy). The registry itself stays in shared as pure
-- fallback/typing data -- see runPipeline.ts for the DB-backed lookup.
--
-- file_shape distinguishes three onboarding paths:
--   'custom'     -- backed by a hand-written parser under src/vendor/ (the
--                   4 rows backfilled below). Never created via the API.
--   'simple_csv' -- a single-header-row CSV, fully described by
--                   column_mapping (JSONB). parsed generically.
--   'plugin'     -- a dynamically require()'d .js file under the vendor
--                   plugins directory (see config/paths.ts /
--                   vendor/pluginLoader.ts), named by plugin_filename.
--
-- brand_allowlist uses TEXT[] (matching reconciliation_rows.warning_codes'
-- existing convention here); column_mapping uses JSONB (matching
-- reconciliation_rows.current_values's convention) since it's a structured
-- object, not a flat list.
--
-- ruleId (VendorRuleConfig.ruleId) is deliberately NOT a column here: it is
-- always derived as `${vendor_key}-inventory-v1`, which is exactly the
-- static ruleId every one of today's 4 vendors already has -- so the
-- backfilled rows produce byte-identical rule config hashes to before this
-- migration.

CREATE TABLE IF NOT EXISTS vendor_configs (
  vendor_key TEXT PRIMARY KEY,
  vendor_label TEXT NOT NULL,
  in_stock_threshold INTEGER NOT NULL,
  timezone TEXT NOT NULL,
  brand_allowlist TEXT[] NOT NULL DEFAULT '{}',
  match_strategy TEXT NOT NULL,
  missing_blocker_code TEXT,
  file_shape TEXT NOT NULL DEFAULT 'custom',
  column_mapping JSONB,
  plugin_filename TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Routes a dynamically-configured vendor's uploaded file (kind =
-- 'vendor_dynamic') back to the vendor_configs row that parsed it. NULL for
-- every other FileKind.
ALTER TABLE files ADD COLUMN vendor_key TEXT;

-- Backfill today's 4 hardcoded VENDOR_REGISTRY entries
-- (packages/shared/src/vendorRegistry.ts) so they immediately show up as
-- editable in the Manage Vendors UI with identical values.
INSERT INTO vendor_configs (vendor_key, vendor_label, in_stock_threshold, timezone, brand_allowlist, match_strategy, missing_blocker_code, file_shape)
VALUES
  ('olliix', 'Olliix', 6, 'America/New_York', ARRAY['Beautyrest','Serta','True North by Sleep Philosophy','Woolrich','Sharper Image'], 'upc-to-gtin', 'MISSING_FROM_OLLIIX', 'custom'),
  ('kh', 'K&H Pet Products', 3, 'America/New_York', ARRAY['K&H Pet Products'], 'upc-to-gtin', NULL, 'custom'),
  ('gobi', 'Gobi Heat', 6, 'America/New_York', ARRAY['Gobi Heat'], 'sku-to-mpn', NULL, 'custom'),
  ('fieldsheer', 'FieldSheer/MobileWarming', 6, 'America/New_York', ARRAY['Mobile Warming'], 'sku-to-mpn', NULL, 'custom');
