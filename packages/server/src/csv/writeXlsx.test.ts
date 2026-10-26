import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { rowsToXlsx } from "./writeXlsx";
import { XlsxDocument } from "../vendor/xlsxReader";

const HEADERS = ["PRODUCT_CODE", "UPC", "QTY", "NOTE"];

describe("rowsToXlsx", () => {
  it("round-trips through the app's own xlsx reader", async () => {
    const buffer = await rowsToXlsx(
      [
        { PRODUCT_CODE: "gh-a", UPC: "012345678905", QTY: "10", NOTE: "Fish & <chips>" },
        { PRODUCT_CODE: "gh-b", UPC: "", QTY: "0", NOTE: "" },
      ],
      HEADERS,
      { sheetName: "Exceptions", numericColumns: ["QTY"] },
    );
    const doc = await XlsxDocument.load(buffer);
    expect(doc.getSheetNames()).toEqual(["Exceptions"]);
    const rows = await doc.getRows("Exceptions");
    expect(rows[0]).toEqual(HEADERS);
    expect(rows[1]).toEqual(["gh-a", "012345678905", "10", "Fish & <chips>"]);
    expect(rows[2]![0]).toBe("gh-b");
  });

  it("writes an Excel table with banded-row style, a frozen header row and sized columns", async () => {
    const buffer = await rowsToXlsx([{ PRODUCT_CODE: "gh-a", UPC: "1", QTY: "5", NOTE: "x" }], HEADERS, { sheetName: "Exceptions" });
    const zip = await JSZip.loadAsync(buffer);
    const table = await zip.file("xl/tables/table1.xml")!.async("string");
    expect(table).toContain('ref="A1:D2"');
    expect(table).toContain('<autoFilter ref="A1:D2"/>');
    expect(table).toContain('name="Exceptions"');
    expect(table).toContain('tableStyleInfo name="TableStyleMedium2"');
    expect(table).toContain('showRowStripes="1"');
    for (const h of HEADERS) expect(table).toContain(`name="${h}"`);
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain("<cols>");
    expect(sheet).toContain('<tablePart r:id="rId1"/>');
    const types = await zip.file("[Content_Types].xml")!.async("string");
    expect(types).toContain("spreadsheetml.table+xml");
  });

  it("stores only the listed numeric columns as numbers, keeping identifiers as text", async () => {
    const buffer = await rowsToXlsx([{ PRODUCT_CODE: "a", UPC: "0123", QTY: "7", NOTE: "7" }], HEADERS, { numericColumns: ["QTY"] });
    const sheet = await (await JSZip.loadAsync(buffer)).file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet).toContain('<c r="C2"><v>7</v></c>');
    expect(sheet).toMatch(/<c r="B2" t="s">/);
    expect(sheet).toMatch(/<c r="D2" t="s">/);
  });

  it("writes only a header row (no table) when there are no data rows", async () => {
    const buffer = await rowsToXlsx([], HEADERS);
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("xl/tables/table1.xml")).toBeNull();
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet).not.toContain("tableParts");
  });

  it("neutralizes spreadsheet formulas when asked to, and strips characters illegal in XML", async () => {
    const buffer = await rowsToXlsx([{ PRODUCT_CODE: "=1+1", UPC: "a\u0001b", QTY: "", NOTE: "" }], HEADERS, { sanitizeFormulas: true });
    const rows = await (await XlsxDocument.load(buffer)).getRows("Sheet1");
    expect(rows[1]![0]).not.toBe("=1+1");
    expect(rows[1]![0]).toContain("=1+1");
    expect(rows[1]![1]).toBe("ab");
  });
});
