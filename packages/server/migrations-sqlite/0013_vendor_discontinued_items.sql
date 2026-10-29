-- Cumulative list of products a vendor has told us are discontinued, from the
-- "Discontinued Items Notification" workbook Olliix emails (the daily inventory
-- feed itself carries no lifecycle column). Each upload upserts: an item stays
-- on the list until someone removes it, so a later, shorter notification never
-- un-discontinues an earlier one.
--
-- normalized_upc is the match key (same digits-only normalization the rule
-- engine applies to the feed's UPC), because the feed's item numbers carry a
-- suffix the notification's don't (feed "BR54-0308N" vs list "BR54-0308"), so
-- item_no is display-only. Pairs with vendor_configs.discontinued_threshold:
-- a listed product becomes NLA only when its feed quantity falls below it.
CREATE TABLE IF NOT EXISTS vendor_discontinued_items (
  vendor_key TEXT NOT NULL,
  normalized_upc TEXT NOT NULL,
  item_no TEXT,
  description TEXT,
  division TEXT,
  category TEXT,
  discontinued_date TEXT,
  source_file_id TEXT REFERENCES files(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (vendor_key, normalized_upc)
);
