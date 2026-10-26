import JSZip from "jszip";
import { sanitizeForSpreadsheetViewing } from "./writeCsv";

// A minimal, dependency-light .xlsx writer -- mirrors xlsxReader.ts's choice
// to build directly on jszip rather than pull in a full spreadsheet library.
// Strings go through a shared-strings table (the form Excel itself writes, and
// the one Excel is happiest with for table header cells). The data is written
// as a real Excel Table (banded rows, filter buttons on the header, sortable)
// with a frozen header row and sized columns, so a report opens ready to use
// instead of as a bare grid.

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

/** Excel rejects characters that are illegal in XML 1.0; strip them rather than produce a file Excel has to "repair". */
function stripIllegalXmlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
}

export interface WriteXlsxOptions {
  sanitizeFormulas?: boolean;
  sheetName?: string;
  /** Headers whose plain-number values should be stored as real numbers (right-aligned, summable) rather than text. Leave identifier columns (UPC, SKU) out: numbers would drop leading zeros. */
  numericColumns?: string[];
  /** Excel table style. Medium 2 = blue header with light-blue banded rows. */
  tableStyle?: string;
}

const PLAIN_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const MAX_COLUMN_WIDTH = 60;
const MIN_COLUMN_WIDTH = 10;
/** Rows sampled to size a column; a full scan of a very large report isn't needed to pick a sensible width. */
const WIDTH_SAMPLE_ROWS = 500;

/** A valid Excel table name: starts with a letter or underscore, letters/digits/underscores only. */
function tableNameFor(sheetName: string): string {
  const cleaned = sheetName.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `T_${cleaned}`;
}

/** Table column names must be unique and non-blank (Excel compares them case-insensitively). */
function uniqueColumnNames(headers: string[]): string[] {
  const seen = new Set<string>();
  return headers.map((h, i) => {
    let name = h.trim() === "" ? `Column${i + 1}` : h;
    while (seen.has(name.toLowerCase())) name = `${name}_${i + 1}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

export async function rowsToXlsx<T extends object>(rows: T[], headers: string[], options: WriteXlsxOptions = {}): Promise<Buffer> {
  const sanitize = options.sanitizeFormulas ?? false;
  const sheetName = options.sheetName ?? "Sheet1";
  const numericColumns = new Set(options.numericColumns ?? []);
  const tableStyle = options.tableStyle ?? "TableStyleMedium2";

  const columnNames = uniqueColumnNames(headers);
  const dataRows = rows.map((row) =>
    headers.map((h) => {
      const raw = (row as Record<string, unknown>)[h];
      const text = raw === null || raw === undefined ? "" : stripIllegalXmlChars(String(raw));
      return sanitize ? sanitizeForSpreadsheetViewing(text) : text;
    }),
  );

  const sharedStrings: string[] = [];
  const sharedIndex = new Map<string, number>();
  let stringReferenceCount = 0;
  const stringCell = (ref: string, value: string): string => {
    let idx = sharedIndex.get(value);
    if (idx === undefined) {
      idx = sharedStrings.length;
      sharedStrings.push(value);
      sharedIndex.set(value, idx);
    }
    stringReferenceCount++;
    return `<c r="${ref}" t="s"><v>${idx}</v></c>`;
  };

  const headerCells = columnNames.map((name, i) => stringCell(`${columnLetter(i)}1`, name)).join("");
  const bodyRowsXml = dataRows
    .map((values, r) => {
      const rowNumber = r + 2;
      const cells = values
        .map((v, i) => {
          if (v === "") return "";
          const ref = `${columnLetter(i)}${rowNumber}`;
          if (numericColumns.has(headers[i]!) && PLAIN_NUMBER.test(v)) return `<c r="${ref}"><v>${v}</v></c>`;
          return stringCell(ref, v);
        })
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");
  const sheetDataXml = `<sheetData><row r="1">${headerCells}</row>${bodyRowsXml}</sheetData>`;

  const widths = headers.map((h, i) => {
    let longest = h.length + 4; // room for the filter button
    for (const values of dataRows.slice(0, WIDTH_SAMPLE_ROWS)) longest = Math.max(longest, values[i]!.length + 2);
    return Math.min(Math.max(longest, MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH);
  });
  const colsXml = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
  const viewsXml = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;

  // A table needs a header plus at least one data row to be valid; with zero
  // rows the sheet is just the header, exactly as before.
  const hasTable = headers.length > 0 && dataRows.length > 0;
  const lastRef = `${columnLetter(headers.length - 1)}${dataRows.length + 1}`;
  const tableName = tableNameFor(sheetName);
  const tablePartsXml = hasTable ? `<tableParts count="1"><tablePart r:id="rId1"/></tableParts>` : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${viewsXml}${colsXml}${sheetDataXml}${tablePartsXml}</worksheet>`;
  const tableXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="${xmlEscape(tableName)}" displayName="${xmlEscape(tableName)}" ref="A1:${lastRef}" totalsRowShown="0"><autoFilter ref="A1:${lastRef}"/><tableColumns count="${columnNames.length}">${columnNames
    .map((n, i) => `<tableColumn id="${i + 1}" name="${xmlEscape(n)}"/>`)
    .join("")}</tableColumns><tableStyleInfo name="${xmlEscape(tableStyle)}" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${stringReferenceCount}" uniqueCount="${sharedStrings.length}">${sharedStrings
    .map((s) => `<si><t xml:space="preserve">${xmlEscape(s)}</t></si>`)
    .join("")}</sst>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>`;
  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${
    hasTable ? `<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>` : ""
  }</Types>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml);
  zip.file("_rels/.rels", rootRelsXml);
  zip.file("xl/workbook.xml", workbookXml);
  zip.file("xl/_rels/workbook.xml.rels", workbookRelsXml);
  zip.file("xl/sharedStrings.xml", sharedStringsXml);
  zip.file("xl/worksheets/sheet1.xml", sheetXml);
  if (hasTable) {
    zip.file("xl/worksheets/_rels/sheet1.xml.rels", sheetRelsXml);
    zip.file("xl/tables/table1.xml", tableXml);
  }

  return zip.generateAsync({ type: "nodebuffer" });
}
