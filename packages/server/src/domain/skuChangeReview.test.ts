import { describe, it, expect } from "vitest";
import { buildSkuChangeReview } from "./skuChangeReview";
import type { RunningChangeRow } from "../vendor/runningChangeParser";

const change = (over: Partial<RunningChangeRow>): RunningChangeRow => ({
  sourceRowNumber: 2,
  actionText: "1A - ADD NEW SKU NOW",
  tier: "1A",
  oldSku: "BR50-0751",
  newSku: "BR50-0751N",
  upcRaw: "675716836900",
  product: "Throw",
  mivaProductCodeHint: "",
  oldStock: "",
  newStock: "",
  packQty: "1 to 4",
  notes: "",
  ...over,
});
const miva = [{ productCode: "throw-iv", gtinRaw: "675716836900", mpnRaw: "BR50-0751" }];
const dealerItems = [{ itemNo: "BR50-0751N", totalQtyRaw: "1264" }];

function run(c: RunningChangeRow, opts: { dealer?: typeof dealerItems; disc?: string[]; m?: typeof miva } = {}) {
  return buildSkuChangeReview({
    changes: [c],
    miva: opts.m ?? miva,
    dealerItems: opts.dealer ?? dealerItems,
    discontinuedItemNos: opts.disc ?? [],
  })[0]!;
}

describe("buildSkuChangeReview", () => {
  it("renames a tier 1A product whose new SKU is in the dealer file", () => {
    const r = run(change({}));
    expect(r.PROPOSED_ACTION).toBe("RENAME");
    expect(r.MIVA_PRODUCT_CODE).toBe("throw-iv");
    expect(r.NEW_SKU_QTY).toBe("1264");
  });
  it("holds tier 1C and anything whose new SKU is not in the dealer file", () => {
    expect(run(change({ tier: "1C" })).PROPOSED_ACTION).toBe("HOLD");
    expect(run(change({}), { dealer: [] }).PROPOSED_ACTION).toBe("HOLD");
  });
  it("holds when the new SKU is discontinued", () => {
    const r = run(change({}), { disc: ["br50-0751n"] });
    expect(r.PROPOSED_ACTION).toBe("HOLD");
    expect(r.NEW_SKU_DISCONTINUED).toBe("Yes");
  });
  it("holds when no Miva product has the UPC, or the MPN is not the old SKU", () => {
    expect(run(change({}), { m: [] }).PROPOSED_ACTION).toBe("HOLD");
    expect(run(change({}), { m: [{ ...miva[0]!, mpnRaw: "OTHER" }] }).PROPOSED_ACTION).toBe("HOLD");
  });
  it("skips tiers 2 and 3 and already-renamed products", () => {
    expect(run(change({ tier: "2" })).PROPOSED_ACTION).toBe("SKIP");
    expect(run(change({ tier: "3" })).PROPOSED_ACTION).toBe("SKIP");
    expect(run(change({}), { m: [{ ...miva[0]!, mpnRaw: "BR50-0751N" }] }).PROPOSED_ACTION).toBe("SKIP");
  });
});
