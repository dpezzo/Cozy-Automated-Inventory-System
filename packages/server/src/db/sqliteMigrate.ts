import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { defaultSqlitePath, sqliteMigrationsDir } from "../config/paths";

export function runSqliteMigrations(dbPath: string = defaultSqlitePath()): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);

    const appliedRows = db.prepare("SELECT filename FROM schema_migrations").all() as { filename: string }[];
    const applied = new Set(appliedRows.map((r) => r.filename));

    const dir = sqliteMigrationsDir();
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(path.join(dir, file), "utf8");
      // eslint-disable-next-line no-console
      console.log(`Applying SQLite migration: ${file}`);
      db.exec("BEGIN");
      try {
        db.exec(sql);
        db.prepare("INSERT INTO schema_migrations (filename) VALUES (?)").run(file);
        db.exec("COMMIT");
        appliedCount++;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }

    // eslint-disable-next-line no-console
    console.log(appliedCount === 0 ? "No new SQLite migrations to apply." : `Applied ${appliedCount} SQLite migration(s).`);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    runSqliteMigrations();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("SQLite migration failed:", err);
    process.exit(1);
  }
}
