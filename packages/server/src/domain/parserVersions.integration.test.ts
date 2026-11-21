import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteRepository } from "../db/sqliteRepository";

// vite can't resolve the node:sqlite builtin by itself, so hand it the real module through Node's own loader.
vi.mock("node:sqlite", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(__filename)("node:sqlite");
});
// Real SQLite (migrations included) so the new columns, the setting and the per-file version are exercised for real.
let repo: SqliteRepository;
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getRepository: () => repo,
}));
vi.mock("../storage/fileStorage", () => ({
  computeChecksum: (b: Buffer) => `sum-${b.length}`,
  storedFileExists: () => false,
  saveUploadedFile: (b: Buffer, _kind: string, ext: string) => ({ storagePath: `fake/${b.length}${ext}`, checksum: `sum-${b.length}`, sizeBytes: b.length }),
}));

import { uploadVendorFileAutoDetect } from "./uploadService";
import { updateVendorConfig, listVendorConfigs } from "./vendorConfigService";
import { getVendorFileAdapter } from "../vendor/vendorFileRegistry";

const VENDORS = path.resolve(__dirname, "../../../../../Vendors");
const NEW_LAYOUT = readFileSync(path.join(VENDORS, "Inventory_Report_20261121.xlsx"));
const OLD_LAYOUT = readFileSync(path.join(VENDORS, "Inventory_Report_20261024.xlsx"));

let tmp: string;
let userId: string;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "parser-versions-"));
  repo = new SqliteRepository(path.join(tmp, "test.db"));
  await repo.init();
  userId = (await repo.createUser({ email: "t@example.com", role: "admin", passwordHash: "x" })).id;
});
afterAll(async () => {
  await repo.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("versioned vendor parsers", () => {
  it("Gobi starts on v2 after the migration and is the only vendor offering a version choice", async () => {
    expect((await repo.findVendorConfigByKey("gobi"))!.activeParserVersion).toBe("v2");
    expect((await repo.findVendorConfigByKey("olliix"))!.activeParserVersion).toBeNull();
    const configs = await listVendorConfigs();
    expect(configs.find((c) => c.vendorKey === "gobi")!.parserVersions.map((v) => v.version)).toEqual(["v1", "v2"]);
    expect(configs.find((c) => c.vendorKey === "olliix")!.parserVersions).toEqual([]);
  });

  it("an upload records which version read it; the new layout is v2 with no fallback", async () => {
    const r = await uploadVendorFileAutoDetect(NEW_LAYOUT, "Inventory_Report_20261121.xlsx", userId, false);
    expect(r.detectedVendorLabel).toBe("Gobi Heat");
    expect(r.parserVersion).toBe("v2");
    expect(r.parserFellBackFrom).toBeNull();
    expect(r.file.parserVersion).toBe("v2");
    expect((await repo.findFileById(r.file.id))!.parserVersion).toBe("v2");
  });

  it("an old-layout file falls back to v1 while v2 is active, and the file remembers v1", async () => {
    const r = await uploadVendorFileAutoDetect(OLD_LAYOUT, "Inventory_Report_20261024.xlsx", userId, false);
    expect(r.parserVersion).toBe("v1");
    expect(r.parserFellBackFrom).toBe("v2");
    expect(r.file.parserVersion).toBe("v1");
  });

  it("switching the active version is validated and audited, and changes which version goes first", async () => {
    await expect(updateVendorConfig("gobi", { activeParserVersion: "v9" }, userId)).rejects.toMatchObject({ code: "PARSER_VERSION_UNKNOWN" });
    await expect(updateVendorConfig("olliix", { activeParserVersion: "v1" }, userId)).rejects.toMatchObject({ code: "PARSER_VERSION_NOT_APPLICABLE" });

    expect((await updateVendorConfig("gobi", { activeParserVersion: "v1" }, userId)).activeParserVersion).toBe("v1");
    const old = await uploadVendorFileAutoDetect(OLD_LAYOUT, "Inventory_Report_20261024_b.xlsx", userId, true);
    expect(old.parserVersion).toBe("v1");
    expect(old.parserFellBackFrom).toBeNull();
    const fresh = await uploadVendorFileAutoDetect(NEW_LAYOUT, "Inventory_Report_20261121_b.xlsx", userId, true);
    expect(fresh.parserVersion).toBe("v2");
    expect(fresh.parserFellBackFrom).toBe("v1");

    expect((await updateVendorConfig("gobi", { activeParserVersion: null }, userId)).activeParserVersion).toBeNull();
    await updateVendorConfig("gobi", { activeParserVersion: "v2" }, userId);
  });

  it("re-reading a stored file uses the version it was stored with, whatever the setting says now", async () => {
    await updateVendorConfig("gobi", { activeParserVersion: "v1" }, userId);
    const adapter = getVendorFileAdapter("gobi_workbook")!;
    // Setting says v1, but this file was stored as v2: forcing v2 reads it without any fallback.
    const reread = await adapter.parse(NEW_LAYOUT, { forceVersion: "v2" });
    expect(reread.parserVersion).toBe("v2");
    expect(reread.parserFellBackFrom).toBeUndefined();
    // And forcing the wrong version is a hard error, never a silent switch.
    await expect(adapter.parse(NEW_LAYOUT, { forceVersion: "v1" })).rejects.toMatchObject({ code: "REQUIRED_COLUMNS_MISSING" });
    await updateVendorConfig("gobi", { activeParserVersion: "v2" }, userId);
  });
});
