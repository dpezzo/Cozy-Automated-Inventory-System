-- Adds role-based access, Google sign-in, and soft-deactivation to users.
-- password_hash stays NOT NULL here too, kept mechanically in sync with the
-- SQLite migration -- see its comment for the '' sentinel used for
-- Google-only users. "Must have password_hash OR google_id" is enforced in
-- the application layer (see packages/server/src/auth.ts and
-- domain/userService.ts), not by a DB constraint.

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
