import { Store } from "express-session";
import type { SessionData } from "express-session";
import { DatabaseSync } from "node:sqlite";

/**
 * A minimal express-session Store backed by the same SQLite database as the
 * rest of the application, so signing in survives a server restart without
 * requiring PostgreSQL. Expired rows are swept lazily on read/write.
 */
export class SqliteSessionStore extends Store {
  constructor(private readonly db: DatabaseSync) {
    super();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  private sweep(): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  }

  get(sid: string, callback: (err: unknown, session?: SessionData | null) => void): void {
    try {
      this.sweep();
      const row = this.db.prepare("SELECT data FROM sessions WHERE sid = ? AND expires_at >= ?").get(sid, Date.now()) as
        | { data: string }
        | undefined;
      callback(null, row ? (JSON.parse(row.data) as SessionData) : null);
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
    try {
      const maxAgeMs = session.cookie?.originalMaxAge ?? 1000 * 60 * 60 * 12;
      const expiresAt = Date.now() + maxAgeMs;
      this.db
        .prepare(
          `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
        )
        .run(sid, JSON.stringify(session), expiresAt);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      this.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
    this.set(sid, session, callback);
  }
}
