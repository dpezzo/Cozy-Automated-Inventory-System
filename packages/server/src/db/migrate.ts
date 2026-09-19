/* eslint-disable no-console */
import "dotenv/config";
import { getDbDriver } from "./index";

async function main() {
  const driver = getDbDriver();
  if (driver === "postgres") {
    await import("./postgresMigrate");
    return;
  }
  const { runSqliteMigrations } = await import("./sqliteMigrate");
  runSqliteMigrations();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
