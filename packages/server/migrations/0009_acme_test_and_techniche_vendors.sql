-- Backfills two vendors that only existed as live-created rows in the local
-- dev database (not previously tracked in git) onto every environment,
-- including production: see packages/server/migrations/0003_vendor_configs.sql
-- for the same backfill-via-migration pattern used for the original 4
-- vendors.
--
-- 'acme-test': a synthetic test vendor for the 10 "Acme Test Brand" products
-- imported into the live Miva store for end-to-end testing of the simple-CSV
-- upload path without touching real vendor data.
--
-- 'techniche': labeled "(Occunomix)" because its plugin_filename
-- (occunomix.js, seeded by packages/server/vendor-plugins-seed/ -- see
-- seedPluginFiles.ts) actually parses Occunomix's UTF-16LE/tab-delimited
-- export, not a real TechNiche file -- this vendor has no matching inventory
-- yet and is a placeholder until TechNiche's real file is available.
-- ON CONFLICT DO NOTHING because this vendor_key may already exist locally
-- from being created directly through the Manage Vendors UI.

INSERT INTO vendor_configs (vendor_key, vendor_label, in_stock_threshold, timezone, brand_allowlist, match_strategy, missing_blocker_code, file_shape, column_mapping)
VALUES
  ('acme-test', 'Acme Test Brand', 6, 'America/New_York', ARRAY['Acme Test Brand'], 'upc-to-gtin', NULL, 'simple_csv',
   '{"identifierColumn":"UPC","identifierType":"upc","descriptionColumn":"Description","quantityColumn":"Quantity"}'::jsonb)
ON CONFLICT (vendor_key) DO NOTHING;

INSERT INTO vendor_configs (vendor_key, vendor_label, in_stock_threshold, timezone, brand_allowlist, match_strategy, missing_blocker_code, file_shape, plugin_filename)
VALUES
  ('techniche', 'TechNiche International (Occunomix)', 6, 'America/New_York', ARRAY['TechNiche','TechNiche International'], 'sku-to-mpn', NULL, 'plugin', 'occunomix.js')
ON CONFLICT (vendor_key) DO NOTHING;
