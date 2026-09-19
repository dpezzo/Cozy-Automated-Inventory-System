import { parse } from "csv-parse/sync";
import type { MivaRawRow } from "@cozywinters/shared";
import { ValidationError } from "../errors";

/** Physical Miva export headers mapped to logical snapshot fields, per MVP_CSV_Contracts.md section 2. */
export const MIVA_HEADER_MAP: Record<string, keyof MivaLogicalRow> = {
  PRODUCT_CODE: "productCode",
  PRODUCT_NAME: "productName",
  "*DF-GTIN": "gtin",
  "*DF-MPN": "mpn",
  "*DF-PRODUCT_BRAND": "brand",
  "*CUSTOM_SIMPLE_INVENTORY": "simpleInventory",
  "*DF-AVAILABILITY": "availability",
  "*ORD-INV_RESTOCK_DATE_DF-MERG-IN:": "restockMessage",
  "*DF-DATAFEED": "dataFeed",
  "*DF-SHOPPING_FEED": "shoppingFeed",
  "SHOW_IN_DARREN_INVENTORY_REPORT_(1)": "reportFlag",
  // Optional: not in REQUIRED_LOGICAL_FIELDS, so snapshots without this column still parse.
  PRODUCT_TYPE: "productType",
  PRODUCT_URL: "productUrl",
  PRODUCT_THUMBNAIL: "thumbnailUrl",
};

interface MivaLogicalRow {
  productCode: string;
  productName: string;
  gtin: string;
  mpn: string;
  brand: string;
  simpleInventory: string;
  availability: string;
  restockMessage: string;
  dataFeed: string;
  shoppingFeed: string;
  reportFlag: string;
  productType: string;
  productUrl: string;
  thumbnailUrl: string;
}

const REQUIRED_LOGICAL_FIELDS: (keyof MivaLogicalRow)[] = [
  "productCode",
  "productName",
  "gtin",
  "mpn",
  "brand",
  "simpleInventory",
  "availability",
  "restockMessage",
  "dataFeed",
  "shoppingFeed",
  "reportFlag",
];

export interface ParsedMivaCsv {
  rows: MivaRawRow[];
}

/** Strips a UTF-8 BOM that spreadsheet exports commonly prepend. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseMivaSnapshotCsv(fileContent: string): ParsedMivaCsv {
  let records: Record<string, string>[];
  try {
    records = parse(stripBom(fileContent), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: false,
    });
  } catch (err) {
    throw new ValidationError("FILE_UNREADABLE", "The uploaded file could not be read as a CSV.", err);
  }

  if (records.length === 0) {
    throw new ValidationError("ZERO_DATA_ROWS", "The Miva snapshot contains zero usable data rows.");
  }

  const headerRow = Object.keys(records[0]!);
  const headerCounts = new Map<string, number>();
  for (const h of headerRow) headerCounts.set(h, (headerCounts.get(h) ?? 0) + 1);
  const duplicates = [...headerCounts.entries()].filter(([, count]) => count > 1).map(([h]) => h);
  if (duplicates.length > 0) {
    throw new ValidationError(
      "DUPLICATE_HEADERS",
      `The Miva snapshot has duplicate column headers: ${duplicates.join(", ")}.`,
      { duplicates },
    );
  }

  const foundLogical = new Set<keyof MivaLogicalRow>();
  for (const h of headerRow) {
    const logical = MIVA_HEADER_MAP[h];
    if (logical) foundLogical.add(logical);
  }
  const missingLogical = REQUIRED_LOGICAL_FIELDS.filter((f) => !foundLogical.has(f));
  if (missingLogical.length > 0) {
    throw new ValidationError(
      "REQUIRED_COMPARISON_FIELD_MISSING",
      `The Miva snapshot is missing required comparison fields: ${missingLogical.join(", ")}.`,
      { missingLogical },
    );
  }

  const physicalByLogical = new Map<keyof MivaLogicalRow, string>();
  for (const [physical, logical] of Object.entries(MIVA_HEADER_MAP)) {
    if (headerRow.includes(physical)) physicalByLogical.set(logical, physical);
  }

  const get = (record: Record<string, string>, field: keyof MivaLogicalRow): string =>
    record[physicalByLogical.get(field)!] ?? "";

  const rows: MivaRawRow[] = records.map((record, i) => ({
    sourceRowNumber: i + 1,
    productCode: get(record, "productCode").trim(),
    productName: get(record, "productName"),
    gtinRaw: get(record, "gtin"),
    mpnRaw: get(record, "mpn"),
    brandRaw: get(record, "brand"),
    currentSimpleInventory: get(record, "simpleInventory"),
    currentAvailability: get(record, "availability"),
    currentRestockMessage: get(record, "restockMessage"),
    currentDataFeed: get(record, "dataFeed"),
    currentShoppingFeed: get(record, "shoppingFeed"),
    currentReportFlag: get(record, "reportFlag"),
    productType: get(record, "productType"),
    productUrl: get(record, "productUrl"),
    thumbnailUrl: get(record, "thumbnailUrl"),
  }));

  return { rows };
}

export function mivaRowsByProductCode(rows: MivaRawRow[]): Map<string, MivaRawRow> {
  const map = new Map<string, MivaRawRow>();
  for (const row of rows) {
    if (row.productCode) map.set(row.productCode, row);
  }
  return map;
}
