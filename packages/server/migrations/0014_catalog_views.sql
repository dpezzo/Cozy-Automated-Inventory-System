-- Saved Catalog views (columns, order, widths, filters, sort). Private to the
-- owner unless is_shared, in which case every signed-in user can apply it; only
-- the owner or an admin can change or delete it. config is the JSON described
-- by CatalogViewConfig in packages/shared/src/catalogView.ts (validated on
-- write and on read, versioned so later additions don't break old rows).
CREATE TABLE IF NOT EXISTS catalog_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES users(id),
  is_shared BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_views_owner ON catalog_views (owner_user_id);

-- Which view opens by default. scope is 'team' (set by an admin) or
-- 'user:<user id>' (a person's own choice). view_id is either a catalog_views id
-- or a built-in id like 'builtin:all', so it is deliberately not a foreign key;
-- deleting a view clears any default that points at it.
CREATE TABLE IF NOT EXISTS catalog_view_defaults (
  scope TEXT PRIMARY KEY,
  view_id TEXT NOT NULL
);
