import { describe, it, expect, vi, beforeEach } from "vitest";

const findFileById = vi.fn();
const listRuns = vi.fn();
const insertRun = vi.fn();
const updateRunStatus = vi.fn();
const insertReconciliationRows = vi.fn();
const setRunRuleInfo = vi.fn();
const insertAuditLog = vi.fn();
const findVendorConfigByKey = vi.fn();
const findRunById = vi.fn();

vi.mock("../db", () => ({
  getRepository: () => ({
    findFileById,
    listRuns,
    insertRun,
    updateRunStatus,
    insertReconciliationRows,
    setRunRuleInfo,
    insertAuditLog,
    findVendorConfigByKey,
    findRunById,
  }),
}));

vi.mock("../storage/fileStorage", () => ({
  readStoredFile: () => Buffer.from(""),
  readStoredFileText: () => MIVA_SNAPSHOT_CSV,
  storedFileExists: () => true,
}));

vi.mock("../vendor/vendorFileRegistry", () => ({
  getVendorFileAdapter: () => ({
    vendorKey: "acme",
    parse: async () => ({
      rows: [
        {
          sourceRowNumber: 1,
          itemNoRaw: "SKU-TRACKED",
          upcRaw: null,
          skuRaw: "SKU-TRACKED",
          descriptionRaw: "Tracked product",
          totalQtyRaw: "10",
        },
      ],
    }),
  }),
}));

// One tracked product (DS_INV_MGT = "1") that the vendor file also references,
// and one untracked product (DS_INV_MGT blank) that only exists in Miva --
// exactly the "present in Miva, absent from vendor file" shape that would
// otherwise synthesize a MISSING-REVIEW-REQUIRED row for every one of the
// ~8,000 untracked SKUs if this filter weren't applied before reconciliation.
const MIVA_SNAPSHOT_CSV = [
  "PRODUCT_CODE,PRODUCT_NAME,*DF-GTIN,*DF-MPN,*DF-PRODUCT_BRAND,*CUSTOM_SIMPLE_INVENTORY,*DF-AVAILABILITY,*ORD-INV_RESTOCK_DATE_DF-MERG-IN:,*DF-DATAFEED,*DF-SHOPPING_FEED,DROPSHIP_INVENTORY_MANAGEMENT",
  "TRACKED-1,Tracked product,,MPN-TRACKED,Acme,IN STOCK,in stock,,Yes,,1",
  "UNTRACKED-1,Untracked product,,MPN-UNTRACKED,Acme,IN STOCK,in stock,,Yes,,",
].join("\n");

describe("createRun Miva tracked-only filter", () => {
  beforeEach(() => {
    findFileById.mockReset();
    listRuns.mockReset();
    insertRun.mockReset();
    updateRunStatus.mockReset();
    insertReconciliationRows.mockReset();
    setRunRuleInfo.mockReset();
    insertAuditLog.mockReset();
    findVendorConfigByKey.mockReset();
    findRunById.mockReset();

    findFileById.mockImplementation(async (id: string) =>
      id === "v1" ? { id, kind: "olliix_workbook", storagePath: "irrelevant" } : { id, kind: "miva_snapshot", storagePath: "irrelevant" },
    );
    listRuns.mockResolvedValue([]);
    insertRun.mockResolvedValue({ id: "run-1", status: "validating" });
    findVendorConfigByKey.mockResolvedValue({
      vendorKey: "acme",
      vendorLabel: "Acme",
      inStockThreshold: 6,
      timezone: "America/New_York",
      brandAllowlist: ["Acme"],
      matchStrategy: "sku-to-mpn",
      missingBlockerCode: undefined,
      isActive: true,
    });
    findRunById.mockResolvedValue({ id: "run-1", status: "ready" });
  });

  it("never passes a blank-DS_INV_MGT Miva row into reconciliation, even as a Miva-only row", async () => {
    const { createRun } = await import("./runService");
    await createRun({
      vendorFileId: "v1",
      mivaFileId: "m1",
      runDate: { year: 2026, month: 9, day: 18 },
      createdBy: "u1",
    });

    expect(insertReconciliationRows).toHaveBeenCalledTimes(1);
    const rows = insertReconciliationRows.mock.calls[0]![1] as Array<{ productCode: string | null }>;
    const productCodes = rows.map((r) => r.productCode);
    expect(productCodes).toContain("TRACKED-1");
    expect(productCodes).not.toContain("UNTRACKED-1");
  });
});
