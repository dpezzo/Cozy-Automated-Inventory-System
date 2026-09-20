import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseGenericCsv, parseGenericVendorFile } from "./genericCsvParser";

const CSV = ["UPC,Description,Qty", "012345678905,Widget,10", "012345678912,Gadget,0"].join("\n");

/** Builds a minimal single-sheet .xlsx buffer (inline strings, no sharedStrings.xml) for exercising the xlsx path of a "simple_csv" vendor without a fixture file on disk. */
async function buildMinimalXlsx(rows: string[][]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0"?><workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  const cellXml = (rowIdx: number, values: string[]) =>
    `<row r="${rowIdx + 1}">${values
      .map((v, colIdx) => {
        const col = String.fromCharCode(65 + colIdx);
        return `<c r="${col}${rowIdx + 1}" t="inlineStr"><is><t>${v}</t></is></c>`;
      })
      .join("")}</row>`;
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0"?><worksheet><sheetData>${rows.map((r, i) => cellXml(i, r)).join("")}</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

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

describe("parseGenericVendorFile", () => {
  it("parses a CSV buffer the same as parseGenericCsv", async () => {
    const result = await parseGenericVendorFile(Buffer.from(CSV, "utf8"), {
      identifierColumn: "UPC",
      identifierType: "upc",
      descriptionColumn: "Description",
      quantityColumn: "Qty",
    });
    expect(result.rows).toHaveLength(2);
  });

  it("parses an .xlsx buffer using the same column mapping", async () => {
    const xlsx = await buildMinimalXlsx([
      ["UPC", "Description", "Qty"],
      ["012345678905", "Widget", "10"],
      ["012345678912", "Gadget", "0"],
    ]);
    const result = await parseGenericVendorFile(xlsx, {
      identifierColumn: "UPC",
      identifierType: "upc",
      descriptionColumn: "Description",
      quantityColumn: "Qty",
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ upcRaw: "012345678905", descriptionRaw: "Widget", totalQtyRaw: "10" });
    expect(result.rows[1]).toMatchObject({ upcRaw: "012345678912", totalQtyRaw: "0" });
  });

  it("throws REQUIRED_COLUMNS_MISSING for an .xlsx missing a mapped column", async () => {
    const xlsx = await buildMinimalXlsx([
      ["SKU", "Qty"],
      ["ABC-1", "5"],
    ]);
    await expect(
      parseGenericVendorFile(xlsx, { identifierColumn: "UPC", identifierType: "upc", quantityColumn: "Qty" }),
    ).rejects.toThrowError(/missing required columns/i);
  });
});
