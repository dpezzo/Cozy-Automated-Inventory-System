import { describe, it, expect } from "vitest";
import { reconcile } from "./reconcile";
import { computeRuleConfigHash } from "./vendorRegistry";
import { VENDOR_REGISTRY } from "./vendorRegistry";
import type { MivaRawRow, VendorRawRow } from "./types";

const FS = VENDOR_REGISTRY.fieldsheer;
const RUN_DATE = { year: 2026, month: 11, day: 23 };

function vendorRow(sku: string, qty: string, n: number): VendorRawRow {
  return { sourceRowNumber: n, itemNoRaw: sku, upcRaw: null, skuRaw: sku, descriptionRaw: `Item ${sku}`, totalQtyRaw: qty };
}

function miva(code: string, mpn: string, overrides: Partial<MivaRawRow> = {}): MivaRawRow {
  return {
    sourceRowNumber: 1,
    productCode: code,
    productName: code,
    gtinRaw: null,
    mpnRaw: mpn,
    brandRaw: FS.brandAllowlist[0] ?? "Mobile Warming",
    currentSimpleInventory: "SOLD OUT",
    currentAvailability: "out of stock",
    currentRestockMessage: "",
    currentDataFeed: "Yes",
    currentShoppingFeed: "",
    currentDsInvMgt: "1",
    ...overrides,
  };
}

const MIVA = [miva("cat-bowl", "BOWL1"), miva("dog-bowl", "BOWL1"), miva("solo", "SOLO1")];
const FILE = [vendorRow("BOWL1", "15", 2), vendorRow("SOLO1", "15", 3)];

describe("shared Miva key (one SKU on several Miva products)", () => {
  it("blocks the ambiguous row by default (nothing is updated)", () => {
    const { rows } = reconcile(FILE, MIVA, { config: { ...FS, updateAllOnSharedKey: undefined }, runDate: RUN_DATE });
    const bowl = rows.filter((r) => r.itemNo === "BOWL1");
    expect(bowl).toHaveLength(1);
    expect(bowl[0]!.matchOutcome).toBe("BLOCKED AMBIGUOUS MIVA KEY");
    expect(bowl[0]!.changed).toBe(false);
  });

  it("updates every product sharing the key, one flagged row each, when the vendor opts in", () => {
    const { rows } = reconcile(FILE, MIVA, { config: { ...FS, updateAllOnSharedKey: true }, runDate: RUN_DATE });
    const bowl = rows.filter((r) => r.itemNo === "BOWL1");
    expect(bowl.map((r) => r.productCode).sort()).toEqual(["cat-bowl", "dog-bowl"]);
    for (const r of bowl) {
      expect(r.matchOutcome).toBe("MATCHED");
      expect(r.warningCodes).toContain("SHARED_MIVA_KEY");
      expect(r.reviewClass).toBe("WARNING");
      expect(r.changed).toBe(true);
      expect(r.proposed.simpleInventory).toBe("IN STOCK");
      expect(r.isEligibleForApproval).toBe(true);
    }
    // A normal unique match is untouched and not flagged.
    const solo = rows.find((r) => r.itemNo === "SOLO1")!;
    expect(solo.warningCodes).not.toContain("SHARED_MIVA_KEY");
    // Neither shared product is also reported as Miva only.
    expect(rows.filter((r) => r.matchOutcome === "MISSING - REVIEW REQUIRED")).toHaveLength(0);
  });

  it("still blocks a shared-key row that is itself duplicated in the vendor file", () => {
    const dupFile = [vendorRow("BOWL1", "15", 2), vendorRow("BOWL1", "9", 3)];
    const { rows } = reconcile(dupFile, MIVA, { config: { ...FS, updateAllOnSharedKey: true }, runDate: RUN_DATE });
    expect(rows.filter((r) => r.itemNo === "BOWL1").every((r) => r.matchOutcome === "BLOCKED DUPLICATE VENDOR KEY")).toBe(true);
  });

  it("only changes the rule config hash when the option is on", () => {
    const off = computeRuleConfigHash({ ...FS, updateAllOnSharedKey: undefined });
    expect(computeRuleConfigHash({ ...FS, updateAllOnSharedKey: false })).toBe(off);
    expect(computeRuleConfigHash({ ...FS, updateAllOnSharedKey: true })).not.toBe(off);
  });
});
