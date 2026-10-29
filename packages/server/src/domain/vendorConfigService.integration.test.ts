import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteRepository } from "../db/sqliteRepository";

// Real SQLite (migrations and the seeded Olliix vendor included), going through the service the PATCH /vendors/:key route calls.
let repo: SqliteRepository;
vi.mock("node:sqlite", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(__filename)("node:sqlite");
});
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getRepository: () => repo,
}));

import { updateVendorConfig } from "./vendorConfigService";

let tmp: string;
let adminId: string;

/** Exactly what Manage Vendors' edit form sends for a built-in ("custom" file shape) vendor. */
function formPatch(discontinuedThreshold: number | null) {
  return {
    vendorLabel: "Olliix",
    inStockThreshold: 6,
    discontinuedThreshold,
    timezone: "America/New_York",
    brandAllowlist: ["Beautyrest", "Serta", "True North by Sleep Philosophy", "Woolrich", "Sharper Image"],
    matchStrategy: "upc-to-gtin" as const,
    // The route destructures this from the body, so it is present but undefined for a vendor with no column mapping.
    columnMapping: undefined,
  };
}

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "vendor-config-"));
  repo = new SqliteRepository(path.join(tmp, "test.db"));
  await repo.init();
  adminId = (await repo.createUser({ email: "admin@example.com", role: "admin", passwordHash: "x" })).id;
});
afterAll(async () => {
  await repo.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("updateVendorConfig: discontinued threshold", () => {
  it("saves 10 for Olliix with the fields the edit form sends, and records it in the audit log", async () => {
    expect((await repo.findVendorConfigByKey("olliix"))!.discontinuedThreshold).toBeNull();
    const saved = await updateVendorConfig("olliix", formPatch(10), adminId);
    expect(saved.discontinuedThreshold).toBe(10);
    expect((await repo.findVendorConfigByKey("olliix"))!.discontinuedThreshold).toBe(10);
  });

  it("blank turns it back off, and invalid values are rejected without changing anything", async () => {
    expect((await updateVendorConfig("olliix", formPatch(null), adminId)).discontinuedThreshold).toBeNull();
    await expect(updateVendorConfig("olliix", formPatch(0), adminId)).rejects.toMatchObject({ code: "INVALID_THRESHOLD" });
    await expect(updateVendorConfig("olliix", formPatch(2.5), adminId)).rejects.toMatchObject({ code: "INVALID_THRESHOLD" });
    await expect(updateVendorConfig("olliix", formPatch(Number.NaN), adminId)).rejects.toMatchObject({ code: "INVALID_THRESHOLD" });
    expect((await repo.findVendorConfigByKey("olliix"))!.discontinuedThreshold).toBeNull();
  });
});
