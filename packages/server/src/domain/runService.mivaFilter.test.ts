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
        {
          sourceRowNumber: 2,
          itemNoRaw: "MPN-UNTRACKED",
          upcRaw: null,
          skuRaw: "MPN-UNTRACKED",
          descriptionRaw: "Untracked product referenced by vendor",
          totalQtyRaw: "10",
        },
      ],
    }),
  }),
}));

// One tracked product (DS_INV_MGT = "1") that the vendor file also
// references, and one untracked product (DS_INV_MGT blank) that the vendor
// file ALSO references -- the blank-flag filter no longer happens before
// reconciliation, so this genuine match must now surface as a WARNING
// (MIVA_NOT_DROPSHIP_TRACKED) instead of being silently dropped. A third,
// Miva-only untracked product (never referenced by the vendor file) must
// still never synthesize a MISSING-REVIEW-REQUIRED row -- that's what
// would otherwise flood in for every one of the ~8,000 untracked SKUs.
const MIVA_SNAPSHOT_CSV = [
  "PRODUCT_CODE,PRODUCT_NAME,*DF-GTIN,*DF-MPN,*DF-PRODUCT_BRAND,*CUSTOM_SIMPLE_INVENTORY,*DF-AVAILABILITY,*ORD-INV_RESTOCK_DATE_DF-MERG-IN:,*DF-DATAFEED,*DF-SHOPPING_FEED,DROPSHIP_INVENTORY_MANAGEMENT",
  "TRACKED-1,Tracked product,,MPN-TRACKED,Acme,IN STOCK,in stock,,Yes,,1",
  "UNTRACKED-1,Untracked product referenced by vendor,,MPN-UNTRACKED,Acme,IN STOCK,in stock,,Yes,,",
  "UNTRACKED-ORPHAN,Untracked orphan product,,MPN-ORPHAN,Acme,IN STOCK,in stock,,Yes,,",
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

  it("a blank-DS_INV_MGT Miva row with no vendor match still never becomes a MISSING row", async () => {
    const { createRun } = await import("./runService");
    await createRun({
      vendorFileId: "v1",
      mivaFileId: "m1",
      runDate: { year: 2026, month: 9, day: 18 },
      createdBy: "u1",
    });

    expect(insertReconciliationRows).toHaveBeenCalledTimes(1);
    const rows = insertReconciliationRows.mock.calls[0]![1] as Array<{
      productCode: string | null;
      reviewClass: string;
      warningCodes: string[];
    }>;
    const productCodes = rows.map((r) => r.productCode);
    expect(productCodes).toContain("TRACKED-1");
    expect(productCodes).not.toContain("UNTRACKED-ORPHAN");

    // The blank-flagged product the vendor file DOES reference now surfaces
    // as a WARNING instead of being invisible.
    const untrackedMatch = rows.find((r) => r.productCode === "UNTRACKED-1");
    expect(untrackedMatch).toBeDefined();
    expect(untrackedMatch!.reviewClass).toBe("WARNING");
    expect(untrackedMatch!.warningCodes).toContain("MIVA_NOT_DROPSHIP_TRACKED");
  });
});
