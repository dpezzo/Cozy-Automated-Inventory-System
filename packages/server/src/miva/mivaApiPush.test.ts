import { describe, it, expect, vi } from "vitest";
import type { BatchCsvRow } from "@cozywinters/shared";

// mivaApiPush.ts imports ../db (for getRepository) at module scope, which
// transitively pulls in node:sqlite -- irrelevant to these pure-logic tests
// and not resolvable in this test environment, so it's mocked out entirely.
vi.mock("../db", () => ({ getRepository: () => ({}) }));

import { chunk, mapMulticallResults } from "./mivaApiPush";

function row(productCode: string): BatchCsvRow {
  return {
    PRODUCT_CODE: productCode,
    "*CUSTOM_SIMPLE_INVENTORY": "IN STOCK",
    "*DF-AVAILABILITY": "in stock",
    "*ORD-INV_RESTOCK_DATE_DF-MERG-IN:": "",
    "*DF-DATAFEED": "Yes",
    "*DF-SHOPPING_FEED": "",
    "SHOW_IN_DARREN_INVENTORY_REPORT_(1)": "1",
  };
}

describe("chunk", () => {
  it("splits an array into groups of the given size, including a smaller final group", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single group when the array is smaller than the chunk size", () => {
    expect(chunk([1, 2], 100)).toEqual([[1, 2]]);
  });

  it("returns an empty array for an empty input", () => {
    expect(chunk([], 10)).toEqual([]);
  });
});

describe("mapMulticallResults", () => {
  it("maps a bare array response (one entry per iteration) to per-row results in request order", () => {
    const rows = [row("P001"), row("P002")];
    const response = [{ success: 1 }, { success: 1 }];
    expect(mapMulticallResults(rows, response)).toEqual([
      { productCode: "P001", success: true },
      { productCode: "P002", success: true },
    ]);
  });

  it("captures error_code/error_message for a failed iteration without failing the whole batch", () => {
    const rows = [row("P001"), row("P002")];
    const response = [{ success: 1 }, { success: 0, error_code: "MER-JSN-PRD-00014", error_message: "Product not found" }];
    const results = mapMulticallResults(rows, response);
    expect(results[0]).toEqual({ productCode: "P001", success: true });
    expect(results[1]).toEqual({
      productCode: "P002",
      success: false,
      errorCode: "MER-JSN-PRD-00014",
      errorMessage: "Product not found",
    });
  });

  it("never reports a row as successful when the response has no entry for it", () => {
    const rows = [row("P001"), row("P002")];
    const response = [{ success: 1 }]; // missing a second entry
    const results = mapMulticallResults(rows, response);
    expect(results[1]!.success).toBe(false);
    expect(results[1]!.errorMessage).toMatch(/no response/i);
  });

  it("handles a single-object (non-array) response as a one-row result", () => {
    const rows = [row("P001")];
    const response = { success: 1 };
    expect(mapMulticallResults(rows, response)).toEqual([{ productCode: "P001", success: true }]);
  });
});
