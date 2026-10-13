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
