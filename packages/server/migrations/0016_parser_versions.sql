-- Versioned vendor file parsers. A vendor can have more than one registered
-- parser (see vendor/parserVersions.ts); active_parser_version picks which one
-- is tried first, and files.parser_version records which one actually read each
-- uploaded file so a later re-read (run creation) uses the same version even if
-- the setting changes.
--
-- active_parser_version NULL means "the vendor's default" (the registry decides),
-- so every vendor with a single parser is unaffected. Gobi's file layout changed
-- on 2026-11-06 (Product ID + UPC, no Ordering SKU), so it is set to v2 here.
-- files.parser_version is never backfilled: it is NULL for files uploaded before
-- this change, which are re-read with the normal active-then-fallback order.
ALTER TABLE vendor_configs ADD COLUMN active_parser_version TEXT;
UPDATE vendor_configs SET active_parser_version = 'v2' WHERE vendor_key = 'gobi';
ALTER TABLE files ADD COLUMN parser_version TEXT;
