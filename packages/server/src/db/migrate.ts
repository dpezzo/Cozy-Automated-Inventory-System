/* eslint-disable no-console */
import "dotenv/config";
import { getDbDriver } from "./index";
import { seedVendorPluginFiles } from "../vendor/seedPluginFiles";

async function main() {
  const driver = getDbDriver();
  if (driver === "postgres") {
    await import("./postgresMigrate");
  } else {
    const { runSqliteMigrations } = await import("./sqliteMigrate");
    runSqliteMigrations();
  }
  seedVendorPluginFiles();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
