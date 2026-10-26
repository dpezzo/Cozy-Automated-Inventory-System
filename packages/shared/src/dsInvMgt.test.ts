import { describe, it, expect } from "vitest";
import { reconcile } from "./reconcile";
import { computeProposedManagedValues } from "./managedValues";
import { VENDOR_REGISTRY } from "./vendorRegistry";
import type { MivaRawRow, VendorRawRow } from "./types";

const GOBI = VENDOR_REGISTRY.gobi;
const RUN_DATE = { year: 2026, month: 10, day: 25 };

function gobiRow(sku: string, qty: string, phase: string | null = "Active", sourceRowNumber = 2): VendorRawRow {
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

/** What a correctly-set DS_INV_MGT = 2 product looks like when in stock. */
const NO_FEED_IN_STOCK = {
  currentSimpleInventory: "IN STOCK",
  currentAvailability: "",
  currentDataFeed: "",
  currentShoppingFeed: "Exclude",
  currentDsInvMgt: "2",
};

describe("DS_INV_MGT = 2 (manage inventory, never push to the shopping feed)", () => {
  it("computes the feed-excluded values for every status and always keeps DS_INV_MGT at 2", () => {
    for (const status of ["IN STOCK", "SOLD OUT", "NLA"] as const) {
      const v = computeProposedManagedValues(status, null, { feedExcluded: true });
      expect(v.availability).toBe("");
      expect(v.dataFeed).toBe("");
      expect(v.shoppingFeed).toBe("Exclude");
      expect(v.dsInvMgt).toBe("2");
    }
    expect(computeProposedManagedValues("IN STOCK", null, { feedExcluded: true }).simpleInventory).toBe("IN STOCK");
    expect(computeProposedManagedValues("SOLD OUT", "11/01/2026", { feedExcluded: true }).restockMessage).toBe("<b>Out until 11/01/2026</b>");
    expect(computeProposedManagedValues("NLA", null, { feedExcluded: true }).simpleInventory).toBe("NO LONGER AVAILABLE");
  });

  it("leaves value 1 and blank products on the normal recipe", () => {
    expect(computeProposedManagedValues("IN STOCK", null)).toEqual(computeProposedManagedValues("IN STOCK", null, { feedExcluded: false }));
    expect(computeProposedManagedValues("IN STOCK", null).dsInvMgt).toBe("1");
  });

  it("is UNCHANGED when an in-stock product at 2 is already set correctly", () => {
    const { rows } = reconcile([gobiRow("A", "50")], [miva("A", NO_FEED_IN_STOCK)], { config: GOBI, runDate: RUN_DATE });
    expect(rows[0]!.reviewClass).toBe("UNCHANGED");
  });

  it("proposes sold out with the feed-excluded values and keeps 2, not 1", () => {
    const { rows } = reconcile([gobiRow("A", "2")], [miva("A", NO_FEED_IN_STOCK)], { config: GOBI, runDate: RUN_DATE });
    expect(rows[0]!.reviewClass).toBe("CLEAN");
    expect(rows[0]!.proposed).toMatchObject({ simpleInventory: "SOLD OUT", availability: "", dataFeed: "", shoppingFeed: "Exclude", dsInvMgt: "2" });
  });

  it("fixes a product at 2 whose shopping feed is not Exclude, without changing DS_INV_MGT", () => {
    const { rows } = reconcile([gobiRow("A", "50")], [miva("A", { ...NO_FEED_IN_STOCK, currentShoppingFeed: "", currentDataFeed: "Yes", currentAvailability: "in stock" })], {
      config: GOBI,
      runDate: RUN_DATE,
    });
    expect(rows[0]!.reviewClass).toBe("CLEAN");
    expect(rows[0]!.proposed.dsInvMgt).toBe("2");
    expect(rows[0]!.proposed.shoppingFeed).toBe("Exclude");
  });

  it("proposes NLA for a discontinued product at 2 while keeping the feed-excluded values and 2", () => {
    const { rows } = reconcile([gobiRow("A", "3", "Discontinued")], [miva("A", NO_FEED_IN_STOCK)], { config: GOBI, runDate: RUN_DATE });
    expect(rows[0]!.proposed).toMatchObject({ simpleInventory: "NO LONGER AVAILABLE", availability: "", dataFeed: "", shoppingFeed: "Exclude", dsInvMgt: "2" });
    expect(rows[0]!.warningCodes).toEqual([]);
  });

  it("is not flagged as an untracked product (non-blank DS_INV_MGT counts as managed)", () => {
    const { rows } = reconcile([gobiRow("A", "2")], [miva("A", NO_FEED_IN_STOCK)], { config: GOBI, runDate: RUN_DATE });
    expect(rows[0]!.warningCodes).not.toContain("MIVA_NOT_DROPSHIP_TRACKED");
  });

  it("proposes NLA, still at 2, when it is missing from the vendor file", () => {
    const { rows } = reconcile([], [miva("A", NO_FEED_IN_STOCK)], { config: GOBI, runDate: RUN_DATE });
    expect(rows[0]!.warningCodes).toEqual(["MISSING_FROM_VENDOR_PROPOSED_NLA"]);
    expect(rows[0]!.proposed.dsInvMgt).toBe("2");
  });
});

describe("DS_INV_MGT = 3 (hidden from the app)", () => {
  const hidden = miva("H", { currentDsInvMgt: "3" });

  it("produces no row for the hidden product, even though it is absent from the vendor file", () => {
    const { rows } = reconcile([], [hidden], { config: GOBI, runDate: RUN_DATE });
    expect(rows).toEqual([]);
  });

  it("silently skips a vendor row that can only match the hidden product", () => {
    const { rows } = reconcile([gobiRow("H", "40", "Active", 2), gobiRow("A", "40", "Active", 3)], [hidden, miva("A")], { config: GOBI, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.itemNo).toBe("A");
  });

  it("still matches a vendor row to a visible product that shares the identifier with a hidden one", () => {
    const visibleTwin = miva("H", { productCode: "gh-H-twin", currentDsInvMgt: "1" });
    const { rows } = reconcile([gobiRow("H", "40")], [hidden, visibleTwin], { config: GOBI, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchOutcome).toBe("MATCHED");
    expect(rows[0]!.productCode).toBe("gh-H-twin");
  });

  it("does not hide a vendor row because of a '3' on a product from another brand", () => {
    const otherBrand = miva("H", { brandRaw: "Some Other Brand", currentDsInvMgt: "3" });
    const { rows } = reconcile([gobiRow("H", "40")], [otherBrand], { config: GOBI, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reviewClass).toBe("BLOCKED");
  });

  it("is a no-op when no product is set to 3", () => {
    const { rows } = reconcile([gobiRow("A", "40")], [miva("A")], { config: GOBI, runDate: RUN_DATE });
    expect(rows).toHaveLength(1);
  });
});
