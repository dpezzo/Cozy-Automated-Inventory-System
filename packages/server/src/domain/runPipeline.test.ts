import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VendorRawRow, MivaRawRow } from "@cozywinters/shared";

const findVendorConfigByKey = vi.fn();

vi.mock("../db", () => ({
  getRepository: () => ({ findVendorConfigByKey }),
}));

// Minimal 1-vendor-row/1-miva-row fixture where the outcome depends on
// whether the in-stock threshold is 6 (static registry default) or 2
// (this test's DB override): qty 3 is "in stock" only under the lower
// threshold. Proves runPipeline.ts reads inStockThreshold from the
// repository, not from the static VENDOR_REGISTRY object.
const vendorRow: VendorRawRow = {
  sourceRowNumber: 1,
  itemNoRaw: "ITEM-1",
  upcRaw: "012345678905",
  descriptionRaw: "Widget",
  totalQtyRaw: "3",
};
const mivaRow: MivaRawRow = {
  sourceRowNumber: 1,
  productCode: "P001",
  productName: "Widget",
  gtinRaw: "012345678905",
  mpnRaw: null,
  brandRaw: "Acme",
  currentSimpleInventory: "0",
  currentAvailability: "No",
  currentRestockMessage: "",
  currentDataFeed: "No",
  currentShoppingFeed: "No",
  currentReportFlag: "No",
};

function config(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    vendorKey: "acme",
    vendorLabel: "Acme",
    inStockThreshold: 6,
    timezone: "America/New_York",
    brandAllowlist: ["Acme"],
    matchStrategy: "upc-to-gtin",
    missingBlockerCode: null,
    fileShape: "custom",
    columnMapping: null,
    pluginFilename: null,
    isActive: true,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("runReconciliation (DB-backed config)", () => {
  beforeEach(() => {
    findVendorConfigByKey.mockReset();
  });

  it("throws when no active vendor config is found", async () => {
    findVendorConfigByKey.mockResolvedValue(null);
    const { runReconciliation } = await import("./runPipeline");
    await expect(
      runReconciliation({ vendorKey: "acme", vendorRows: [vendorRow], mivaRows: [mivaRow], runDate: { year: 2026, month: 9, day: 18 } }),
    ).rejects.toMatchObject({ code: "VENDOR_CONFIG_NOT_FOUND" });
  });

  it("reflects a DB-overridden threshold that differs from the static registry default", async () => {
    findVendorConfigByKey.mockResolvedValue(config({ inStockThreshold: 2 }));
    const { runReconciliation } = await import("./runPipeline");
    const { rows, ruleId } = await runReconciliation({
      vendorKey: "acme",
      vendorRows: [vendorRow],
      mivaRows: [mivaRow],
      runDate: { year: 2026, month: 9, day: 18 },
    });
    expect(ruleId).toBe("acme-inventory-v1");
    const row = rows.find((r) => r.productCode === "P001")!;
    // qty 3 >= threshold 2 -> IN STOCK under the override.
    expect(row.proposed.simpleInventory).toBe("IN STOCK");
  });

  it("produces a different outcome with the higher static-equivalent threshold", async () => {
    findVendorConfigByKey.mockResolvedValue(config({ inStockThreshold: 6 }));
    const { runReconciliation } = await import("./runPipeline");
    const { rows } = await runReconciliation({
      vendorKey: "acme",
      vendorRows: [vendorRow],
      mivaRows: [mivaRow],
      runDate: { year: 2026, month: 9, day: 18 },
    });
    const row = rows.find((r) => r.productCode === "P001")!;
    // qty 3 < threshold 6 -> SOLD OUT.
    expect(row.proposed.simpleInventory).toBe("SOLD OUT");
  });
});
