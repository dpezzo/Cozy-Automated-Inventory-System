-- See packages/server/migrations/0009_acme_test_and_techniche_vendors.sql
-- for the full explanation -- same backfill, SQLite column_mapping/brand
-- list stored as JSON text per this file's existing 0003 convention.
-- INSERT OR IGNORE because this vendor_key may already exist locally from
-- being created directly through the Manage Vendors UI.

INSERT OR IGNORE INTO vendor_configs (vendor_key, vendor_label, in_stock_threshold, timezone, brand_allowlist, match_strategy, missing_blocker_code, file_shape, column_mapping)
VALUES
  ('acme-test', 'Acme Test Brand', 6, 'America/New_York', '["Acme Test Brand"]', 'upc-to-gtin', NULL, 'simple_csv',
   '{"identifierColumn":"UPC","identifierType":"upc","descriptionColumn":"Description","quantityColumn":"Quantity"}');

INSERT OR IGNORE INTO vendor_configs (vendor_key, vendor_label, in_stock_threshold, timezone, brand_allowlist, match_strategy, missing_blocker_code, file_shape, plugin_filename)
VALUES
  ('techniche', 'TechNiche International (Occunomix)', 6, 'America/New_York', '["TechNiche","TechNiche International"]', 'sku-to-mpn', NULL, 'plugin', 'occunomix.js');
