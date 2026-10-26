import { describe, it, expect } from "vitest";
import { reconcile } from "./reconcile";
import { interpretProductPhase } from "./productPhase";
import { computeProposedManagedValues } from "./managedValues";
import { computeRuleConfigHash, VENDOR_REGISTRY } from "./vendorRegistry";
import type { MivaRawRow, VendorRawRow } from "./types";

const GOBI = VENDOR_REGISTRY.gobi;
const RUN_DATE = { year: 2026, month: 10, day: 25 };

function gobiRow(sku: string, qty: string, phase: string | null): VendorRawRow {
  return {
    sourceRowNumber: 2,
    itemNoRaw: sku,
    upcRaw: null,
    skuRaw: sku,
    descriptionRaw: "Test jacket",
    totalQtyRaw: qty,
    productPhaseRaw: phase,
  };
}

function mivaGobi(overrides: Partial<MivaRawRow> = {}): MivaRawRow {
  return {
    sourceRowNumber: 1,
    productCode: "gh-test-S",
    productName: "Test jacket",
    gtinRaw: null,
    mpnRaw: "TEST-S",
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

const NLA_VALUES = computeProposedManagedValues("NLA", null);

/** A Miva product that is already set up exactly like the standard NLA recipe. */
function mivaAlreadyNla(): MivaRawRow {
  return mivaGobi({
    currentSimpleInventory: NLA_VALUES.simpleInventory,
    currentAvailability: NLA_VALUES.availability,
    currentRestockMessage: NLA_VALUES.restockMessage,
    currentDataFeed: NLA_VALUES.dataFeed,
    currentShoppingFeed: NLA_VALUES.shoppingFeed,
    currentDsInvMgt: NLA_VALUES.dsInvMgt,
  });
}

describe("interpretProductPhase", () => {
  it("recognizes the three Gobi phase values, including the (EOL) suffix", () => {
    expect(interpretProductPhase("Active")).toBe("ACTIVE");
    expect(interpretProductPhase("End of Life (EOL)")).toBe("END_OF_LIFE_OR_DISCONTINUED");
    expect(interpretProductPhase("Discontinued")).toBe("END_OF_LIFE_OR_DISCONTINUED");
  });

  it("is case and spacing insensitive", () => {
    expect(interpretProductPhase("  end   of  LIFE ")).toBe("END_OF_LIFE_OR_DISCONTINUED");
    expect(interpretProductPhase("EOL")).toBe("END_OF_LIFE_OR_DISCONTINUED");
    expect(interpretProductPhase("discontinued")).toBe("END_OF_LIFE_OR_DISCONTINUED");
    expect(interpretProductPhase("ACTIVE")).toBe("ACTIVE");
  });

  it("treats a blank or missing phase as Active, and an unknown phase as unrecognized", () => {
    expect(interpretProductPhase(null)).toBe("ACTIVE");
    expect(interpretProductPhase("")).toBe("ACTIVE");
    expect(interpretProductPhase("Coming Soon")).toBe("UNRECOGNIZED");
  });
});

describe("computeProposedManagedValues: NLA", () => {
  it("uses the standard NLA recipe agreed with Cale", () => {
    expect(NLA_VALUES).toEqual({
      simpleInventory: "NO LONGER AVAILABLE",
      availability: "",
      restockMessage: "",
      dataFeed: "",
      shoppingFeed: "Exclude",
      dsInvMgt: "",
    });
  });
});

describe("reconcile: Gobi End of Life / Discontinued NLA rule", () => {
  const run = (vendor: VendorRawRow, miva: MivaRawRow) => reconcile([vendor], [miva], { config: GOBI, runDate: RUN_DATE }).rows;

  it.each([
    ["9", "End of Life (EOL)"],
    ["5", "Discontinued"],
    ["0", "Discontinued"],
  ])("proposes NLA for %s units when the phase is %s", (qty, phase) => {
    const [row] = run(gobiRow("TEST-S", qty, phase), mivaGobi());
    expect(row!.proposed.simpleInventory).toBe("NO LONGER AVAILABLE");
    expect(row!.proposed.shoppingFeed).toBe("Exclude");
    expect(row!.proposed.dsInvMgt).toBe("");
    expect(row!.reviewClass).toBe("CLEAN");
    expect(row!.changed).toBe(true);
  });

  it("follows the normal stock rule at exactly 10 units (not NLA)", () => {
    const [row] = run(gobiRow("TEST-S", "10", "Discontinued"), mivaGobi());
    expect(row!.proposed.simpleInventory).toBe("IN STOCK");
  });

  it("follows the normal stock rule for 10+ units on an End of Life product", () => {
    const [row] = run(gobiRow("TEST-S", "40", "End of Life (EOL)"), mivaGobi());
    expect(row!.proposed.simpleInventory).toBe("IN STOCK");
  });

  it("never proposes NLA for an Active product, however low its quantity", () => {
    const [row] = run(gobiRow("TEST-S", "0", "Active"), mivaGobi());
    expect(row!.proposed.simpleInventory).toBe("SOLD OUT");
  });

  it("keeps the 6-unit in-stock threshold for Active products", () => {
    expect(run(gobiRow("TEST-S", "6", "Active"), mivaGobi({ currentSimpleInventory: "SOLD OUT" }))[0]!.proposed.simpleInventory).toBe("IN STOCK");
    expect(run(gobiRow("TEST-S", "5", "Active"), mivaGobi())[0]!.proposed.simpleInventory).toBe("SOLD OUT");
  });

  it("treats the old file format (no phase column) as all Active", () => {
    const [row] = run(gobiRow("TEST-S", "2", null), mivaGobi());
    expect(row!.proposed.simpleInventory).toBe("SOLD OUT");
    expect(row!.warningCodes).toEqual([]);
  });

  it("treats an unrecognized phase as Active but warns", () => {
    const [row] = run(gobiRow("TEST-S", "20", "Coming Soon"), mivaGobi());
    expect(row!.proposed.simpleInventory).toBe("IN STOCK");
    expect(row!.warningCodes).toContain("UNRECOGNIZED_PRODUCT_PHASE");
    expect(row!.reviewClass).toBe("UNCHANGED");
  });

  it("resolves a product already set up as standard NLA to UNCHANGED, with no tracked/discontinued warnings", () => {
    const [row] = run(gobiRow("TEST-S", "3", "Discontinued"), mivaAlreadyNla());
    expect(row!.reviewClass).toBe("UNCHANGED");
    expect(row!.warningCodes).toEqual([]);
    expect(row!.changed).toBe(false);
  });

  it("resolves a legacy-style NLA product (shopping feed not Exclude) to a plain CLEAN fix-up, not a warning", () => {
    const legacy = mivaGobi({
      currentSimpleInventory: "NO LONGER AVAILABLE",
      currentAvailability: "",
      currentDataFeed: "No",
      currentShoppingFeed: "",
      currentDsInvMgt: "",
    });
    const [row] = run(gobiRow("TEST-S", "0", "Discontinued"), legacy);
    expect(row!.reviewClass).toBe("CLEAN");
    expect(row!.warningCodes).toEqual([]);
  });

  it("requires warning acknowledgement to reactivate an NLA product the vendor now says is Active with stock", () => {
    const [row] = run(gobiRow("TEST-S", "50", "Active"), mivaAlreadyNla());
    expect(row!.reviewClass).toBe("WARNING");
    expect(row!.warningCodes).toEqual(expect.arrayContaining(["MIVA_NOT_DROPSHIP_TRACKED", "MIVA_MARKED_DISCONTINUED"]));
    // On approval it writes the full tracked IN STOCK values, including DS_INV_MGT = 1.
    expect(row!.proposed).toEqual(computeProposedManagedValues("IN STOCK", null));
    expect(row!.proposed.dsInvMgt).toBe("1");
    expect(row!.proposed.shoppingFeed).toBe("");
    expect(row!.isEligibleForApproval).toBe(true);
  });

  it("requires warning acknowledgement to reactivate an NLA product that is End of Life but has 10+ units", () => {
    const [row] = run(gobiRow("TEST-S", "30", "End of Life (EOL)"), mivaAlreadyNla());
    expect(row!.reviewClass).toBe("WARNING");
    expect(row!.proposed.simpleInventory).toBe("IN STOCK");
  });
});

describe("reconcile: live Gobi product missing from the vendor file", () => {
  it("is a WARNING proposing NLA (approvable), not a hard block", () => {
    const { rows } = reconcile([], [mivaGobi()], { config: GOBI, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchOutcome).toBe("MISSING - REVIEW REQUIRED");
    expect(rows[0]!.reviewClass).toBe("WARNING");
    expect(rows[0]!.warningCodes).toEqual(["MISSING_FROM_VENDOR_PROPOSED_NLA"]);
    expect(rows[0]!.blockerCodes).toEqual([]);
    expect(rows[0]!.proposed).toEqual(NLA_VALUES);
    expect(rows[0]!.changed).toBe(true);
    expect(rows[0]!.isEligibleForApproval).toBe(true);
  });

  it("stays quietly UNCHANGED when Miva already shows it as NO LONGER AVAILABLE", () => {
    const { rows } = reconcile([], [mivaGobi({ currentSimpleInventory: "NO LONGER AVAILABLE" })], { config: GOBI, runDate: RUN_DATE });
    expect(rows[0]!.reviewClass).toBe("UNCHANGED");
    expect(rows[0]!.isEligibleForApproval).toBe(false);
  });

  it("keeps the original hard block for vendors that have not opted in to NLA handling", () => {
    const { rows } = reconcile([], [mivaGobi({ brandRaw: "Mobile Warming" })], { config: VENDOR_REGISTRY.fieldsheer, runDate: RUN_DATE });
    expect(rows[0]!.reviewClass).toBe("BLOCKED");
    expect(rows[0]!.blockerCodes).toEqual(["MISSING_FROM_VENDOR"]);
  });
});

describe("reconcile: product phase carried onto rows", () => {
  it("attaches the vendor's phase text to vendor-sourced rows only", () => {
    const { rows } = reconcile([gobiRow("TEST-S", "3", "End of Life (EOL)")], [mivaGobi(), mivaGobi({ productCode: "gh-other", mpnRaw: "OTHER" })], {
      config: GOBI,
      runDate: RUN_DATE,
    });
    const matched = rows.find((r) => r.matchOutcome === "MATCHED")!;
    const missing = rows.find((r) => r.matchOutcome === "MISSING - REVIEW REQUIRED")!;
    expect(matched.productPhase).toBe("End of Life (EOL)");
    expect(missing.productPhase).toBeUndefined();
  });

  it("leaves rows untouched when the vendor file has no phase column", () => {
    const { rows } = reconcile([gobiRow("TEST-S", "3", null)], [mivaGobi()], { config: GOBI, runDate: RUN_DATE });
    expect("productPhase" in rows[0]!).toBe(false);
  });
});

describe("computeRuleConfigHash", () => {
  it("is unchanged for vendors that do not set discontinuedThreshold", () => {
    const withoutField = { ...VENDOR_REGISTRY.fieldsheer };
    expect(computeRuleConfigHash(withoutField)).toBe(computeRuleConfigHash({ ...withoutField, discontinuedThreshold: undefined }));
  });

  it("differs for a vendor once discontinuedThreshold is set", () => {
    const fs = VENDOR_REGISTRY.fieldsheer;
    expect(computeRuleConfigHash({ ...fs, discontinuedThreshold: 10 })).not.toBe(computeRuleConfigHash(fs));
  });
});
