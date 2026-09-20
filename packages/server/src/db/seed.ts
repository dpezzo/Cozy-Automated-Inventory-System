/* eslint-disable no-console */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { getDbDriver, initRepository, closeRepository } from "./index";

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required to seed the administrator.");
  }
  if (password.length < 12) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters for the local test administrator.");
  }

  const driver = getDbDriver();
  const repo = await initRepository();
  // One-time bootstrap only -- once any user exists (including one created
  // via Manage Users), never touch it again here, so a later run of this
  // script can't silently reset a live admin's password.
  const existingUsers = await repo.listUsers();
  if (existingUsers.length > 0) {
    console.log(`Users table already has ${existingUsers.length} user(s); skipping seed.`);
    await closeRepository();
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await repo.upsertUser(email, passwordHash);
  console.log(`Seeded administrator account (${driver}): ${email}`);
  await closeRepository();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
