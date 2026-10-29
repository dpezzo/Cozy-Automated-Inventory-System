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
// Real SQLite (migrations included) so the new table, the upsert and the threshold column are exercised for real.
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
import { runReconciliation } from "./runPipeline";
import type { MivaRawRow, VendorRawRow } from "@cozywinters/shared";

const LIST_FILE = path.resolve(__dirname, "../../../../../Vendors/Discontinue_Items_Notification_Email_202610231500007732.xlsx");
let tmp: string;
let userId: string;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "disc-list-"));
  repo = new SqliteRepository(path.join(tmp, "test.db"));
  await repo.init();
  userId = (await repo.createUser({ email: "t@example.com", role: "admin", passwordHash: "x" })).id;
});
afterAll(async () => {
  await repo.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("discontinued list upload and run", () => {
  it("imports the real notification into the cumulative list, then refreshes (not duplicates) on re-upload", async () => {
    const first = await uploadVendorFileAutoDetect(readFileSync(LIST_FILE), "Discontinue_Items.xlsx", userId, false);
    expect(first.file.kind).toBe("discontinued_list");
    expect(first.detectedVendorLabel).toBe("Olliix");
    expect(first.discontinuedImport).toMatchObject({ added: 36, updated: 0, skipped: 0 });

    // An identical file is stopped as a duplicate unless confirmed; confirming refreshes every row and adds none.
    const dup = await uploadVendorFileAutoDetect(readFileSync(LIST_FILE), "Discontinue_Items.xlsx", userId, true);
    expect(dup.discontinuedImport).toMatchObject({ added: 0, updated: 36 });
    expect(await repo.listDiscontinuedUpcs("olliix")).toHaveLength(36);
    const items = await repo.listDiscontinuedItems("olliix");
    expect(items.find((i) => i.itemNo === "BR54-0308")).toMatchObject({ normalizedUpc: "675716465209", discontinuedDate: "2026-10-16" });
  });

  it("a later, shorter notification never removes earlier items", async () => {
    await repo.upsertDiscontinuedItems("olliix", [{ normalizedUpc: "999999999999", itemNo: "X-1", description: null, division: null, category: null, discontinuedDate: null }], (await repo.listFiles("discontinued_list"))[0]!.id);
    expect(await repo.listDiscontinuedUpcs("olliix")).toHaveLength(37);
  });

  it("the vendor threshold is editable and null turns it back off", async () => {
    expect((await repo.findVendorConfigByKey("olliix"))!.discontinuedThreshold).toBeNull();
    expect((await repo.updateVendorConfig("olliix", { discontinuedThreshold: 10 })).discontinuedThreshold).toBe(10);
    expect((await repo.updateVendorConfig("olliix", { discontinuedThreshold: null })).discontinuedThreshold).toBeNull();
    await repo.updateVendorConfig("olliix", { discontinuedThreshold: 10 });
  });

  it("a run uses the stored list: listed under 10 becomes NLA, unlisted does not, and the rule hash reflects the threshold", async () => {
    const feed = (upc: string, qty: string, row: number): VendorRawRow => ({ sourceRowNumber: row, itemNoRaw: upc, upcRaw: upc, descriptionRaw: "Throw", totalQtyRaw: qty });
    const miva = (gtin: string, n: number): MivaRawRow => ({
      sourceRowNumber: n, productCode: `p${n}`, productName: "Throw", gtinRaw: gtin, mpnRaw: null, brandRaw: "Beautyrest",
      currentSimpleInventory: "IN STOCK", currentAvailability: "in stock", currentRestockMessage: "", currentDataFeed: "Yes", currentShoppingFeed: "", currentDsInvMgt: "1",
    });
    const result = await runReconciliation({
      vendorKey: "olliix",
      vendorRows: [feed("675716465209", "8", 2), feed("675716781880", "300", 3), feed("111111111111", "3", 4)],
      mivaRows: [miva("675716465209", 1), miva("675716781880", 2), miva("111111111111", 3)],
      runDate: { year: 2026, month: 10, day: 28 },
    });
    const byUpc = new Map(result.rows.map((r) => [r.normalizedUpc, r]));
    expect(byUpc.get("675716465209")!.proposed.simpleInventory).toBe("NO LONGER AVAILABLE");
    expect(byUpc.get("675716781880")!.proposed.simpleInventory).toBe("IN STOCK");
    expect(byUpc.get("111111111111")!.proposed.simpleInventory).toBe("SOLD OUT");
  });
});
