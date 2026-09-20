import path from "node:path";

// Resolved relative to this compiled file's location (dist/config/paths.js
// or src/config/paths.ts under tsx), so these paths are correct regardless
// of the process's current working directory when the server is started --
// important because scripts/start-windows.ps1 launches node directly.
// packages/server/src/config -> packages/server -> packages -> app (repo root)
const SERVER_ROOT = path.resolve(__dirname, "..", "..");
export const REPO_ROOT = path.resolve(SERVER_ROOT, "..", "..");

export function defaultDataDir(): string {
  return process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(REPO_ROOT, "data");
}

export function defaultSqlitePath(): string {
  return process.env.SQLITE_PATH ? path.resolve(process.env.SQLITE_PATH) : path.join(defaultDataDir(), "app.db");
}

export function defaultUploadDir(): string {
  return process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(defaultDataDir(), "files");
}

/**
 * Where vendor parser plugin .js files live (see vendor/pluginLoader.ts).
 * Never written to by any HTTP route -- an admin or developer places a
 * plugin file here directly on the server's filesystem.
 */
export function defaultVendorPluginsDir(): string {
  return process.env.VENDOR_PLUGINS_DIR
    ? path.resolve(process.env.VENDOR_PLUGINS_DIR)
    : path.join(defaultDataDir(), "vendor-plugins");
}

export function defaultLogDir(): string {
  return path.join(defaultDataDir(), "logs");
}

export function sqliteMigrationsDir(): string {
  return path.join(SERVER_ROOT, "migrations-sqlite");
}

export function postgresMigrationsDir(): string {
  return path.join(SERVER_ROOT, "migrations");
}
