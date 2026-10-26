import { describe, it, expect } from "vitest";
import { reconcile } from "./reconcile";
import { toVendorExceptionRows, VENDOR_EXCEPTION_HEADERS } from "./reports";
import { VENDOR_REGISTRY } from "./vendorRegistry";
import type { MivaRawRow, VendorRawRow } from "./types";

const GOBI = VENDOR_REGISTRY.gobi;
const RUN_DATE = { year: 2026, month: 10, day: 25 };

function gobiRow(sku: string, qty: string, phase: string | null, sourceRowNumber: number): VendorRawRow {
  return { sourceRowNumber, itemNoRaw: sku, upcRaw: null, skuRaw: sku, descriptionRaw: `Item ${sku}`, totalQtyRaw: qty, productPhaseRaw: phase };
}

function miva(mpn: string, overrides: Partial<MivaRawRow> = {}): MivaRawRow {
  return {
    sourceRowNumber: 1,
    productCode: `gh-${mpn}`,
    productName: mpn,
    gtinRaw: null,
    mpnRaw: mpn,
    brandRaw: "Gobi Heat",
    currentSimpleInventory: "IN STOCK",
    currentAvailability: "in stock",
    currentRestockMessage: "",
    currentDataFeed: "Yes",
    currentShoppingFeed: "",
    currentDsInvMgt: "1",
    ...overrides,
  };
}

describe("toVendorExceptionRows: warnings are exported", () => {
  // A: NLA in Miva, vendor says Active with stock (reactivation warnings).
  // B: live in Miva, absent from the vendor file (missing-from-file warning).
  // C: vendor row with an unrecognized phase.
  const { rows } = reconcile(
    [gobiRow("A", "50", "Active", 2), gobiRow("C", "20", "Coming Soon", 3)],
    [
      miva("A", { currentSimpleInventory: "NO LONGER AVAILABLE", currentAvailability: "", currentDataFeed: "", currentShoppingFeed: "Exclude", currentDsInvMgt: "" }),
      miva("B"),
      miva("C", { currentSimpleInventory: "SOLD OUT", currentAvailability: "out of stock" }),
    ],
    { config: GOBI, runDate: RUN_DATE },
  );

  it("includes Miva-status warning rows when that category is selected", () => {
    const out = toVendorExceptionRows(rows, ["MIVA_STATUS_WARNINGS"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.itemNo).toBe("A");
    expect(out[0]!.reasonCodes).toContain("MIVA_MARKED_DISCONTINUED");
  });

  it("includes the missing-from-file NLA warning under the missing-from-vendor category", () => {
    const out = toVendorExceptionRows(rows, ["MISSING_FROM_VENDOR_FILE"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.productCode).toBe("gh-B");
    expect(out[0]!.reasonCodes).toBe("MISSING_FROM_VENDOR_PROPOSED_NLA");
    expect(out[0]!.outcome).toBe("Miva only");
    expect(out[0]!.proposedStatus).toBe("NO LONGER AVAILABLE");
  });

  it("includes unrecognized-phase warnings and carries every Run Review column", () => {
    const out = toVendorExceptionRows(rows.map((r) => ({ ...r, decisionStatus: "PENDING" })), ["PRODUCT_PHASE_WARNINGS"]);
    expect(out).toHaveLength(1);
    const row = out[0]!;
    expect(row.productPhase).toBe("Coming Soon");
    expect(row.outcome).toBe("Matched");
    expect(row.reviewClass).toBe("WARNING");
    expect(row.mivaStatus).toBe("SOLD OUT");
    expect(row.proposedStatus).toBe("IN STOCK");
    expect(row.decision).toBe("PENDING");
    expect(row.changedFields).toContain("Availability");
  });

  it("returns nothing when no category is selected", () => {
    expect(toVendorExceptionRows(rows, [])).toEqual([]);
  });

  it("lists every Run Review column in the export headers", () => {
    expect([...VENDOR_EXCEPTION_HEADERS]).toEqual(
      expect.arrayContaining(["MIVA_PRODUCT_CODE", "ITEM_NO", "VENDOR_UPC", "OUTCOME", "CLASS", "WARNINGS_BLOCKERS", "TOTAL_QTY", "CURRENT_STATUS", "PROPOSED_STATUS", "PROPOSED_RESTOCK", "PRODUCT_PHASE", "CHANGED_FIELDS", "DECISION"]),
    );
  });
});
