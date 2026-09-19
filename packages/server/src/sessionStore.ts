import type { Store } from "express-session";
import { SqliteRepository } from "./db/sqliteRepository";
import type { Repository } from "./db/Repository";

/**
 * Builds the express-session store matching the active repository backend,
 * so sessions persist across restarts on both the default SQLite path and
 * the optional PostgreSQL path without either depending on the other.
 */
export async function createSessionStore(repo: Repository): Promise<Store> {
  if (repo instanceof SqliteRepository) {
    const { SqliteSessionStore } = await import("./db/sqliteSessionStore");
    return new SqliteSessionStore(repo.getRawConnection());
  }

  const { PostgresRepository } = await import("./db/postgresRepository");
  if (repo instanceof PostgresRepository) {
    const connectPgSimple = (await import("connect-pg-simple")).default;
    const session = await import("express-session");
    const PgSession = connectPgSimple(session.default);
    return new PgSession({ pool: repo.getPool(), tableName: "user_sessions", createTableIfMissing: true });
  }

  throw new Error("No session store available for the active repository backend.");
}
