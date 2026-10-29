import { describe, it, expect } from "vitest";
import { reconcile, DISCONTINUED_LIST_PHASE } from "./reconcile";
import { computeRuleConfigHash, VENDOR_REGISTRY } from "./vendorRegistry";
import type { MivaRawRow, VendorRawRow, VendorRuleConfig } from "./types";

// Olliix runs in "list mode": its feed has no phase column, so an emailed discontinued list supplies it.
const OLLIIX: VendorRuleConfig = { ...VENDOR_REGISTRY.olliix, brandAllowlist: [...VENDOR_REGISTRY.olliix.brandAllowlist], discontinuedThreshold: 10 };
const RUN_DATE = { year: 2026, month: 10, day: 28 };
const LISTED_UPC = "675716465209";
const OTHER_UPC = "086569401335";

function feedRow(upc: string, qty: string, itemNo = "BR54-0308N"): VendorRawRow {
  return { sourceRowNumber: 3, itemNoRaw: itemNo, upcRaw: upc, descriptionRaw: "Throw", totalQtyRaw: qty };
}

function miva(gtin: string, overrides: Partial<MivaRawRow> = {}): MivaRawRow {
  return {
    sourceRowNumber: 1,
    productCode: `p-${gtin}`,
    productName: "Heated throw",
    gtinRaw: gtin,
    mpnRaw: "BR54-0308",
    brandRaw: "Beautyrest",
    currentSimpleInventory: "IN STOCK",
    currentAvailability: "in stock",
    currentRestockMessage: "",
    currentDataFeed: "Yes",
    currentShoppingFeed: "",
    currentDsInvMgt: "1",
    active: "1",
    ...overrides,
  };
}

const run = (vendor: VendorRawRow[], mivaRows: MivaRawRow[], discontinuedUpcs?: ReadonlySet<string>, config = OLLIIX) =>
  reconcile(vendor, mivaRows, { config, runDate: RUN_DATE, discontinuedUpcs }).rows;

describe("reconcile: Olliix discontinued list overlay", () => {
  const listed = new Set([LISTED_UPC]);

  it("a listed product below the threshold becomes NLA", () => {
    const [row] = run([feedRow(LISTED_UPC, "9")], [miva(LISTED_UPC)], listed);
    expect(row!.proposed.simpleInventory).toBe("NO LONGER AVAILABLE");
    expect(row!.productPhase).toBe(DISCONTINUED_LIST_PHASE);
  });

  it("a listed product at or above the threshold stays live under the normal in-stock rule", () => {
    const [row] = run([feedRow(LISTED_UPC, "300")], [miva(LISTED_UPC)], listed);
    expect(row!.proposed.simpleInventory).toBe("IN STOCK");
    expect(row!.productPhase).toBe(DISCONTINUED_LIST_PHASE);
  });

  it("an unlisted product with a low quantity is just SOLD OUT, not NLA", () => {
    const [row] = run([feedRow(OTHER_UPC, "3")], [miva(OTHER_UPC)], listed);
    expect(row!.proposed.simpleInventory).toBe("SOLD OUT");
    expect(row!.productPhase ?? null).toBeNull();
  });

  it("matches on UPC even though the feed's item number has a suffix the list lacks", () => {
    const [row] = run([feedRow(LISTED_UPC, "1", "BR54-0308N")], [miva(LISTED_UPC)], listed);
    expect(row!.proposed.simpleInventory).toBe("NO LONGER AVAILABLE");
  });

  it("a live listed product missing from the feed is proposed as NLA, as a warning", () => {
    const rows = run([feedRow(OTHER_UPC, "50")], [miva(OTHER_UPC), miva(LISTED_UPC, { productCode: "listed-missing" })], listed);
    const missing = rows.find((r) => r.productCode === "listed-missing")!;
    expect(missing.reviewClass).toBe("WARNING");
    expect(missing.warningCodes).toContain("MISSING_FROM_VENDOR_PROPOSED_NLA");
    expect(missing.proposed.simpleInventory).toBe("NO LONGER AVAILABLE");
  });

  it("an unlisted live product missing from the feed keeps the original hard block", () => {
    const rows = run([feedRow(OTHER_UPC, "50")], [miva(OTHER_UPC), miva("111111111111", { productCode: "unlisted-missing" })], listed);
    const missing = rows.find((r) => r.productCode === "unlisted-missing")!;
    expect(missing.reviewClass).toBe("BLOCKED");
    expect(missing.blockerCodes).toContain("MISSING_FROM_OLLIIX");
  });

  it("an empty list behaves like no discontinued handling at all for missing products", () => {
    const rows = run([feedRow(OTHER_UPC, "50")], [miva(OTHER_UPC), miva(LISTED_UPC, { productCode: "listed-missing" })], new Set());
    expect(rows.find((r) => r.productCode === "listed-missing")!.reviewClass).toBe("BLOCKED");
  });

  it("does nothing when the vendor has no discontinued threshold, even if a list is supplied", () => {
    const off: VendorRuleConfig = { ...OLLIIX, discontinuedThreshold: undefined };
    const [row] = run([feedRow(LISTED_UPC, "3")], [miva(LISTED_UPC)], listed, off);
    expect(row!.proposed.simpleInventory).toBe("SOLD OUT");
  });

  it("does not override a phase the vendor's own file already supplied", () => {
    const own: VendorRawRow = { ...feedRow(LISTED_UPC, "300"), productPhaseRaw: "Active" };
    const [row] = run([own], [miva(LISTED_UPC)], listed);
    expect(row!.productPhase).toBe("Active");
    expect(row!.proposed.simpleInventory).toBe("IN STOCK");
  });

  it("leaves the rule config hash of an Olliix config without a threshold untouched (frozen fixture compatibility)", () => {
    const withoutThreshold: VendorRuleConfig = { ...OLLIIX, discontinuedThreshold: undefined };
    expect(computeRuleConfigHash(withoutThreshold)).toBe(computeRuleConfigHash(VENDOR_REGISTRY.olliix));
  });
});
