import type { Repository } from "./Repository";
import { SqliteRepository } from "./sqliteRepository";

export type DbDriver = "sqlite" | "postgres";

export function getDbDriver(): DbDriver {
  const raw = (process.env.DB_DRIVER ?? "sqlite").toLowerCase();
  if (raw === "postgres" || raw === "postgresql" || raw === "pg") return "postgres";
  return "sqlite";
}

let repository: Repository | null = null;

/**
 * Initializes the process-wide Repository singleton. Must be called once
 * during startup (server bootstrap, migration/seed scripts, or tests)
 * before any domain service calls getRepository(). SQLite (native,
 * Docker-free) is the default; DB_DRIVER=postgres switches to the optional
 * Docker/PostgreSQL path. Everything else in the application depends only
 * on the Repository interface, never on this selection logic.
 */
export async function initRepository(): Promise<Repository> {
  if (repository) return repository;
  const driver = getDbDriver();
  const repo: Repository =
    driver === "postgres" ? new (await import("./postgresRepository")).PostgresRepository() : new SqliteRepository();
  await repo.init();
  repository = repo;
  return repo;
}

/** Synchronous accessor for the already-initialized singleton. */
export function getRepository(): Repository {
  if (!repository) {
    throw new Error("Repository not initialized. Call initRepository() during startup before getRepository().");
  }
  return repository;
}

export async function closeRepository(): Promise<void> {
  if (repository) {
    await repository.close();
    repository = null;
  }
}

export type { Repository } from "./Repository";
export * from "./types";
