import JSZip from "jszip";
import { sanitizeForSpreadsheetViewing } from "./writeCsv";

// A minimal, dependency-light .xlsx writer -- mirrors xlsxReader.ts's choice
// to build directly on jszip rather than pull in a full spreadsheet library.
// Writes every cell as inlineStr (no shared-strings table needed), which is
// valid OOXML and perfectly readable by Excel/Sheets, just slightly larger
// than a shared-strings-deduped file. Fine for report-sized row counts.

function columnLetter(zeroBasedIndex: number): string {
  let n = zeroBasedIndex + 1;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function rowXml(values: string[], rowNumber: number): string {
  const cells = values
    .map((v, i) => (v === "" ? "" : `<c r="${columnLetter(i)}${rowNumber}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`))
    .join("");
  return `<row r="${rowNumber}">${cells}</row>`;
}

export interface WriteXlsxOptions {
  sanitizeFormulas?: boolean;
  sheetName?: string;
}

export async function rowsToXlsx<T extends object>(rows: T[], headers: string[], options: WriteXlsxOptions = {}): Promise<Buffer> {
  const sanitize = options.sanitizeFormulas ?? false;
  const sheetName = options.sheetName ?? "Sheet1";

  const dataRows = rows.map((row) =>
    headers.map((h) => {
      const raw = (row as Record<string, unknown>)[h];
      const text = raw === null || raw === undefined ? "" : String(raw);
      return sanitize ? sanitizeForSpreadsheetViewing(text) : text;
    }),
  );

  const rowsXml = [headers, ...dataRows].map((r, i) => rowXml(r, i + 1)).join("");
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml);
  zip.file("_rels/.rels", rootRelsXml);
  zip.file("xl/workbook.xml", workbookXml);
  zip.file("xl/_rels/workbook.xml.rels", workbookRelsXml);
  zip.file("xl/worksheets/sheet1.xml", sheetXml);

  return zip.generateAsync({ type: "nodebuffer" });
}
