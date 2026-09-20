-- Adds role-based access, Google sign-in, and soft-deactivation to users.
-- password_hash stays NOT NULL at the schema level (SQLite can't drop a
-- NOT NULL constraint without a full table-rebuild migration, which is
-- riskier than it's worth for this column). A Google-only user is stored
-- with password_hash = '' (never a valid bcrypt hash, so bcrypt.compare
-- against it always fails closed) -- see sqliteRepository.ts/
-- postgresRepository.ts's PASSWORD_HASH_SENTINEL. "Must have password_hash
-- OR google_id" is enforced in the application layer (see auth.ts and
-- domain/userService.ts), not by a DB constraint.

-- SQLite's ALTER TABLE ADD COLUMN can't carry a UNIQUE constraint directly
-- ("Cannot add a UNIQUE column") -- add the column plain, then a separate
-- unique index. Multiple NULLs are allowed through a unique index (each NULL
-- is distinct), so this doesn't conflict with most users having no google_id.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE users ADD COLUMN google_id TEXT;
CREATE UNIQUE INDEX idx_users_google_id ON users(google_id);
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
