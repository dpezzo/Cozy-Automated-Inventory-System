import { describe, it, expect, vi, beforeEach } from "vitest";

const listRunRows = vi.fn();
const findRunById = vi.fn();
const findFileById = vi.fn();
const findVendorConfigByKey = vi.fn();

vi.mock("../db", () => ({
  getRepository: () => ({
    listRunRows,
    findRunById,
    findFileById,
    findVendorConfigByKey,
  }),
}));

vi.mock("../storage/fileStorage", () => ({
  storedFileExists: () => true,
  readStoredFileText: () => MIVA_SNAPSHOT_CSV,
}));

// Three brand-matched rows (two tracked "1", one blank) plus one row under a
// different brand entirely -- mivaBrandTotal must count every row whose
// brand is in the vendor's allowlist regardless of DS_INV_MGT, and must
// exclude the other-brand row even though it's otherwise a normal row.
const MIVA_SNAPSHOT_CSV = [
  "PRODUCT_CODE,PRODUCT_NAME,*DF-GTIN,*DF-MPN,*DF-PRODUCT_BRAND,*CUSTOM_SIMPLE_INVENTORY,*DF-AVAILABILITY,*ORD-INV_RESTOCK_DATE_DF-MERG-IN:,*DF-DATAFEED,*DF-SHOPPING_FEED,DROPSHIP_INVENTORY_MANAGEMENT",
  "P001,Product 1,,MPN-1,Acme,IN STOCK,in stock,,Yes,,1",
  "P002,Product 2,,MPN-2,Acme,IN STOCK,in stock,,Yes,,1",
  "P003,Product 3,,MPN-3,Acme,IN STOCK,in stock,,Yes,,",
  "P004,Product 4,,MPN-4,Other Brand,IN STOCK,in stock,,Yes,,1",
].join("\n");

describe("getRunSummary mivaBrandTotal", () => {
  beforeEach(() => {
    listRunRows.mockReset();
    findRunById.mockReset();
    findFileById.mockReset();
    findVendorConfigByKey.mockReset();

    listRunRows.mockResolvedValue([]);
    findRunById.mockResolvedValue({ id: "run-1", ruleId: "acme-inventory-v1", mivaFileId: "m1" });
    findFileById.mockResolvedValue({ id: "m1", kind: "miva_snapshot", storagePath: "irrelevant" });
    findVendorConfigByKey.mockResolvedValue({
      vendorKey: "acme",
      brandAllowlist: ["Acme"],
    });
  });

  it("counts every brand-matched Miva row regardless of DS_INV_MGT, excluding other brands", async () => {
    const { getRunSummary } = await import("./runService");
    const summary = await getRunSummary("run-1");
    expect(summary.mivaBrandTotal).toBe(3);
  });

  it("returns null instead of throwing when the Miva snapshot file is gone", async () => {
    findFileById.mockResolvedValue(null);
    const { getRunSummary } = await import("./runService");
    const summary = await getRunSummary("run-1");
    expect(summary.mivaBrandTotal).toBeNull();
  });

  it("returns null when the vendor config can no longer be found", async () => {
    findVendorConfigByKey.mockResolvedValue(null);
    const { getRunSummary } = await import("./runService");
    const summary = await getRunSummary("run-1");
    expect(summary.mivaBrandTotal).toBeNull();
  });
});

describe("listUntrackedBrandRows", () => {
  beforeEach(() => {
    listRunRows.mockReset();
    findRunById.mockReset();
    findFileById.mockReset();
    findVendorConfigByKey.mockReset();

    listRunRows.mockResolvedValue([]);
    findRunById.mockResolvedValue({ id: "run-1", ruleId: "acme-inventory-v1", mivaFileId: "m1" });
    findFileById.mockResolvedValue({ id: "m1", kind: "miva_snapshot", storagePath: "irrelevant" });
    findVendorConfigByKey.mockResolvedValue({
      vendorKey: "acme",
      brandAllowlist: ["Acme"],
    });
  });

  it("synthesizes one informational row per brand-matched product, excluding other brands", async () => {
    const { listUntrackedBrandRows } = await import("./runService");
    const results = await listUntrackedBrandRows("run-1");
    expect(results.map((r) => r.row.productCode).sort()).toEqual(["P001", "P002", "P003"]);
    for (const r of results) {
      expect(r.row.matchOutcome).toBe("IN MIVA - NOT TRACKED");
      expect(r.row.reviewClass).toBe("UNCHANGED");
      expect(r.row.isEligibleForApproval).toBe(false);
      expect(r.decision.status).toBe("PENDING");
    }
  });

  it("excludes a product already covered by a MATCHED or MISSING reconciliation row", async () => {
    listRunRows.mockResolvedValue([{ row: { productCode: "P001", matchOutcome: "MATCHED" }, decision: {} }]);
    const { listUntrackedBrandRows } = await import("./runService");
    const results = await listUntrackedBrandRows("run-1");
    expect(results.map((r) => r.row.productCode).sort()).toEqual(["P002", "P003"]);
  });

  it("still synthesizes a row for a product whose only existing row is a blocked one (e.g. a duplicate vendor key), not just MATCHED/MISSING", async () => {
    listRunRows.mockResolvedValue([{ row: { productCode: "P001", matchOutcome: "BLOCKED DUPLICATE VENDOR KEY" }, decision: {} }]);
    const { listUntrackedBrandRows } = await import("./runService");
    const results = await listUntrackedBrandRows("run-1");
    expect(results.map((r) => r.row.productCode).sort()).toEqual(["P001", "P002", "P003"]);
  });

  it("applies the same filter semantics as the real row list (e.g. search)", async () => {
    const { listUntrackedBrandRows } = await import("./runService");
    const results = await listUntrackedBrandRows("run-1", { search: "P002" });
    expect(results.map((r) => r.row.productCode)).toEqual(["P002"]);
  });

  it("returns an empty list instead of throwing when the run no longer exists", async () => {
    findRunById.mockResolvedValue(null);
    const { listUntrackedBrandRows } = await import("./runService");
    expect(await listUntrackedBrandRows("run-1")).toEqual([]);
  });
});
