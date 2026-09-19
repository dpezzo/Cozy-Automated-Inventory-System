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
  const passwordHash = await bcrypt.hash(password, 12);
  const repo = await initRepository();
  await repo.upsertUser(email, passwordHash);
  console.log(`Seeded administrator account (${driver}): ${email}`);
  await closeRepository();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
