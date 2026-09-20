import { describe, it, expect } from "vitest";
import { parseGenericCsv } from "./genericCsvParser";

const CSV = ["UPC,Description,Qty", "012345678905,Widget,10", "012345678912,Gadget,0"].join("\n");

describe("parseGenericCsv", () => {
  it("parses rows using the given column mapping (upc identifier)", () => {
    const { rows } = parseGenericCsv(Buffer.from(CSV, "utf8"), {
      identifierColumn: "UPC",
      identifierType: "upc",
      descriptionColumn: "Description",
      quantityColumn: "Qty",
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sourceRowNumber: 1,
      upcRaw: "012345678905",
      skuRaw: null,
      descriptionRaw: "Widget",
      totalQtyRaw: "10",
    });
    expect(rows[1]).toMatchObject({ upcRaw: "012345678912", totalQtyRaw: "0" });
  });

  it("reads the identifier as skuRaw when identifierType is 'sku'", () => {
    const skuCsv = ["SKU,Qty", "ABC-1,5"].join("\n");
    const { rows } = parseGenericCsv(Buffer.from(skuCsv, "utf8"), {
      identifierColumn: "SKU",
      identifierType: "sku",
      quantityColumn: "Qty",
    });
    expect(rows[0]).toMatchObject({ skuRaw: "ABC-1", upcRaw: null });
  });

  it("throws REQUIRED_COLUMNS_MISSING when a mapped column is absent", () => {
    expect(() =>
      parseGenericCsv(Buffer.from(CSV, "utf8"), {
        identifierColumn: "NotAColumn",
        identifierType: "upc",
        quantityColumn: "Qty",
      }),
    ).toThrowError(/missing required columns/i);
  });

  it("throws ZERO_DATA_ROWS on a header-only file", () => {
    expect(() =>
      parseGenericCsv(Buffer.from("UPC,Qty\n", "utf8"), {
        identifierColumn: "UPC",
        identifierType: "upc",
        quantityColumn: "Qty",
      }),
    ).toThrowError(/zero usable data rows/i);
  });
});
