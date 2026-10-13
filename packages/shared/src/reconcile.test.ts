import { describe, it, expect } from "vitest";
import { reconcile } from "./reconcile";
import { VENDOR_REGISTRY } from "./vendorRegistry";
import type { MivaRawRow, VendorRawRow } from "./types";

const OLLIIX_RULE_CONFIG = VENDOR_REGISTRY.olliix;
const RUN_DATE = { year: 2026, month: 9, day: 18 };

function emptyOlliixRow(overrides: Partial<VendorRawRow>): VendorRawRow {
  return {
    sourceRowNumber: 3,
    itemNoRaw: "ITEM-1",
    upcRaw: "000000000001",
    descriptionRaw: "Test item",
    totalQtyRaw: "10",
    warehouses: {
      WDC: { invQtyRaw: "10", incomingDateRaw: null, incomingQtyRaw: "0" },
      SD3: { invQtyRaw: "0", incomingDateRaw: null, incomingQtyRaw: "0" },
      SD2: { invQtyRaw: "0", incomingDateRaw: null, incomingQtyRaw: "0" },
    },
    ...overrides,
  };
}

function mivaRow(overrides: Partial<MivaRawRow>): MivaRawRow {
  return {
    sourceRowNumber: 1,
    productCode: "P999",
    productName: "Missing Product",
    gtinRaw: "000000000999",
    mpnRaw: "MPN-999",
    brandRaw: "Serta",
    currentSimpleInventory: "IN STOCK",
    currentAvailability: "in stock",
    currentRestockMessage: "",
    currentDataFeed: "Yes",
    currentShoppingFeed: "",
    currentDsInvMgt: "1",
    ...overrides,
  };
}

describe("reconcile: Miva products missing from Olliix", () => {
  it("flags a missing product as BLOCKED/MISSING - REVIEW REQUIRED when it is not already discontinued", () => {
    const { rows } = reconcile([], [mivaRow({ currentSimpleInventory: "IN STOCK" })], {
      config: OLLIIX_RULE_CONFIG,
      runDate: RUN_DATE,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchOutcome).toBe("MISSING - REVIEW REQUIRED");
    expect(rows[0]!.reviewClass).toBe("BLOCKED");
    expect(rows[0]!.blockerCodes).toEqual(["MISSING_FROM_OLLIIX"]);
    expect(rows[0]!.isEligibleForApproval).toBe(false);
  });

  it("treats an already-discontinued missing product as UNCHANGED, not a review-required exception", () => {
    const { rows } = reconcile([], [mivaRow({ currentSimpleInventory: "NO LONGER AVAILABLE" })], {
      config: OLLIIX_RULE_CONFIG,
      runDate: RUN_DATE,
    });
    expect(rows).toHaveLength(1);
    // Still identifies why the row exists...
    expect(rows[0]!.matchOutcome).toBe("MISSING - REVIEW REQUIRED");
    // ...but is no longer a blocking exception, since Miva already reflects
    // the discontinued state and nothing new is being asserted.
    expect(rows[0]!.reviewClass).toBe("UNCHANGED");
    expect(rows[0]!.blockerCodes).toEqual([]);
    expect(rows[0]!.proposed).toEqual(rows[0]!.current);
    expect(rows[0]!.isEligibleForApproval).toBe(false);
  });

  it("does not treat a missing product as discontinued merely because it is currently SOLD OUT", () => {
    const { rows } = reconcile([], [mivaRow({ currentSimpleInventory: "SOLD OUT" })], {
      config: OLLIIX_RULE_CONFIG,
      runDate: RUN_DATE,
    });
    expect(rows[0]!.reviewClass).toBe("BLOCKED");
    expect(rows[0]!.blockerCodes).toEqual(["MISSING_FROM_OLLIIX"]);
  });

  it("still matches normally when the same product reappears in Olliix, regardless of its prior NLA status", () => {
    const olliix = [emptyOlliixRow({ upcRaw: "000000000999", totalQtyRaw: "10" })];
    const miva = [mivaRow({ currentSimpleInventory: "NO LONGER AVAILABLE" })];
    const { rows } = reconcile(olliix, miva, { config: OLLIIX_RULE_CONFIG, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchOutcome).toBe("MATCHED");
    expect(rows[0]!.proposed.simpleInventory).toBe("IN STOCK");
    expect(rows[0]!.changed).toBe(true);
    expect(rows[0]!.reviewClass).toBe("CLEAN");
  });
});

describe("reconcile: DS_INV_MGT tracked-flag warnings", () => {
  it("forces a genuine match against a blank-DS_INV_MGT Miva row to WARNING with MIVA_NOT_DROPSHIP_TRACKED", () => {
    const olliix = [emptyOlliixRow({ upcRaw: "000000000999", totalQtyRaw: "10" })];
    const miva = [mivaRow({ currentDsInvMgt: "" })];
    const { rows } = reconcile(olliix, miva, { config: OLLIIX_RULE_CONFIG, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchOutcome).toBe("MATCHED");
    expect(rows[0]!.changed).toBe(true);
    expect(rows[0]!.reviewClass).toBe("WARNING");
    expect(rows[0]!.warningCodes).toContain("MIVA_NOT_DROPSHIP_TRACKED");
  });

  it("forces a genuine match against an NLA-flagged Miva row to WARNING with MIVA_CURRENTLY_NLA", () => {
    const olliix = [emptyOlliixRow({ upcRaw: "000000000999", totalQtyRaw: "10" })];
    const miva = [mivaRow({ currentDsInvMgt: "NLA" })];
    const { rows } = reconcile(olliix, miva, { config: OLLIIX_RULE_CONFIG, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchOutcome).toBe("MATCHED");
    expect(rows[0]!.changed).toBe(true);
    expect(rows[0]!.reviewClass).toBe("WARNING");
    expect(rows[0]!.warningCodes).toContain("MIVA_CURRENTLY_NLA");
  });

  it("still resolves CLEAN for a normal tracked (DS_INV_MGT=1) match with no other warning", () => {
    const olliix = [emptyOlliixRow({ upcRaw: "000000000999", totalQtyRaw: "10" })];
    const miva = [mivaRow({ currentSimpleInventory: "SOLD OUT", currentDsInvMgt: "1" })];
    const { rows } = reconcile(olliix, miva, { config: OLLIIX_RULE_CONFIG, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reviewClass).toBe("CLEAN");
    expect(rows[0]!.warningCodes).toEqual([]);
  });

  it("never synthesizes a MISSING row for a blank-DS_INV_MGT, brand-eligible Miva product with no vendor match", () => {
    const { rows } = reconcile([], [mivaRow({ currentDsInvMgt: "" })], {
      config: OLLIIX_RULE_CONFIG,
      runDate: RUN_DATE,
    });
    expect(rows).toHaveLength(0);
  });
});

describe("reconcile: matchStrategy upc-or-sku", () => {
  const DUAL_CONFIG = { ...OLLIIX_RULE_CONFIG, matchStrategy: "upc-or-sku" as const };

  function dualVendorRow(overrides: Partial<VendorRawRow>): VendorRawRow {
    return {
      sourceRowNumber: 3,
      itemNoRaw: "ITEM-1",
      upcRaw: null,
      skuRaw: null,
      descriptionRaw: "Test item",
      totalQtyRaw: "10",
      ...overrides,
    };
  }

  it("matches normally when UPC and SKU agree on the same product", () => {
    const vendor = [dualVendorRow({ upcRaw: "000000000999", skuRaw: "MPN-999" })];
    const miva = [mivaRow({})];
    const { rows } = reconcile(vendor, miva, { config: DUAL_CONFIG, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchOutcome).toBe("MATCHED");
    expect(rows[0]!.productCode).toBe("P999");
  });

  it("blocks with IDENTIFIER_MISMATCH when UPC and SKU each cleanly resolve to different products", () => {
    const vendor = [dualVendorRow({ upcRaw: "000000000999", skuRaw: "MPN-888" })];
    const miva = [mivaRow({ productCode: "P999", gtinRaw: "000000000999", mpnRaw: "MPN-999" }), mivaRow({ productCode: "P888", gtinRaw: "000000000888", mpnRaw: "MPN-888" })];
    const { rows } = reconcile(vendor, miva, { config: DUAL_CONFIG, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchOutcome).toBe("BLOCKED IDENTIFIER MISMATCH");
    expect(rows[0]!.reviewClass).toBe("BLOCKED");
    expect(rows[0]!.blockerCodes).toEqual(["IDENTIFIER_MISMATCH"]);
    expect(rows[0]!.productCode).toBe("P888|P999");
  });

  it("falls back to the UPC match when the SKU is blank", () => {
    const vendor = [dualVendorRow({ upcRaw: "000000000999", skuRaw: null })];
    const miva = [mivaRow({})];
    const { rows } = reconcile(vendor, miva, { config: DUAL_CONFIG, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchOutcome).toBe("MATCHED");
    expect(rows[0]!.productCode).toBe("P999");
  });

  it("falls back to the SKU match when the UPC is blank", () => {
    const vendor = [dualVendorRow({ upcRaw: null, skuRaw: "MPN-999" })];
    const miva = [mivaRow({})];
    const { rows } = reconcile(vendor, miva, { config: DUAL_CONFIG, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchOutcome).toBe("MATCHED");
    expect(rows[0]!.productCode).toBe("P999");
  });

  it("uses a uniquely-resolving SKU to disambiguate a UPC duplicated across two Miva products", () => {
    const vendor = [dualVendorRow({ upcRaw: "000000000999", skuRaw: "MPN-A" })];
    const miva = [
      mivaRow({ productCode: "PA", gtinRaw: "000000000999", mpnRaw: "MPN-A" }),
      mivaRow({ productCode: "PB", gtinRaw: "000000000999", mpnRaw: "MPN-B" }),
    ];
    const { rows } = reconcile(vendor, miva, { config: DUAL_CONFIG, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchOutcome).toBe("MATCHED");
    expect(rows[0]!.productCode).toBe("PA");
  });

  it("stays blocked ambiguous when neither identifier can narrow a duplicated UPC down to one product", () => {
    const vendor = [dualVendorRow({ upcRaw: "000000000999", skuRaw: null })];
    const miva = [
      mivaRow({ productCode: "PA", gtinRaw: "000000000999", mpnRaw: "MPN-A" }),
      mivaRow({ productCode: "PB", gtinRaw: "000000000999", mpnRaw: "MPN-B" }),
    ];
    const { rows } = reconcile(vendor, miva, { config: DUAL_CONFIG, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchOutcome).toBe("BLOCKED AMBIGUOUS MIVA KEY");
  });

  it("blocks a row whose SKU is duplicated in the vendor file even though its UPC is unique", () => {
    const vendor = [
      dualVendorRow({ sourceRowNumber: 3, upcRaw: "000000000999", skuRaw: "MPN-SHARED" }),
      dualVendorRow({ sourceRowNumber: 4, upcRaw: "000000000888", skuRaw: "MPN-SHARED" }),
    ];
    const miva = [mivaRow({ productCode: "P999", gtinRaw: "000000000999", mpnRaw: "MPN-999" })];
    const { rows } = reconcile(vendor, miva, { config: DUAL_CONFIG, runDate: RUN_DATE });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.matchOutcome).toBe("BLOCKED DUPLICATE VENDOR KEY");
      expect(row.blockerCodes).toEqual(["DUPLICATE_VENDOR_SKU"]);
    }
  });

  it("only treats a Miva product as missing when neither its GTIN nor its MPN appears in the vendor file", () => {
    // Vendor file references this product via SKU/MPN only -- its GTIN is
    // never mentioned. Must NOT be treated as missing.
    const vendor = [dualVendorRow({ upcRaw: null, skuRaw: "MPN-999" })];
    const miva = [mivaRow({})];
    const { rows } = reconcile(vendor, miva, { config: DUAL_CONFIG, runDate: RUN_DATE });
    expect(rows.filter((r) => r.matchOutcome === "MISSING - REVIEW REQUIRED")).toHaveLength(0);
  });

  it("flags a Miva product as missing when absent from the vendor file via both identifiers", () => {
    const { rows } = reconcile([], [mivaRow({})], { config: DUAL_CONFIG, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchOutcome).toBe("MISSING - REVIEW REQUIRED");
  });
});
