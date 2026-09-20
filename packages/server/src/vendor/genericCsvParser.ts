import { parse } from "csv-parse/sync";
import type { VendorRawRow } from "@cozywinters/shared";
import { ValidationError } from "../errors";
import { XlsxDocument } from "./xlsxReader";

/**
 * Column-name mapping for a UI-configured "simple CSV" vendor
 * (vendor_configs.file_shape = 'simple_csv'). Every value is the exact CSV
 * header text for that logical field -- this is deliberately the entire
 * configuration surface, so onboarding a vendor whose file is a single
 * header row with named columns needs no new code, only a Manage Vendors
 * form submission. Produced by ManageVendorsPage.tsx's "Simple CSV" form.
 */
export interface GenericCsvColumnMapping {
  identifierColumn: string;
  identifierType: "upc" | "sku";
  descriptionColumn?: string;
  quantityColumn: string;
}

export interface ParsedGenericCsv {
  rows: VendorRawRow[];
}

/**
 * Parses a single-header-row CSV into VendorRawRow[] using a column_mapping
 * (see GenericCsvColumnMapping). Reuses csv-parse the same way
 * khParser.ts/fieldSheerParser.ts do; unlike those, this has no per-vendor
 * quirks (no BOM handling, no brand pre-filtering, no multi-row headers) --
 * that's exactly the class of vendor this path is meant for.
 */
export function parseGenericCsv(buffer: Buffer, mapping: GenericCsvColumnMapping): ParsedGenericCsv {
  let records: Record<string, string>[];
  try {
    records = parse(buffer.toString("utf8"), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: false,
    });
  } catch (err) {
    throw new ValidationError("FILE_UNREADABLE", "The uploaded file could not be read as a CSV.", err);
  }

  if (records.length === 0) {
    throw new ValidationError("ZERO_DATA_ROWS", "The file contains zero usable data rows.");
  }

  const headerRow = Object.keys(records[0]!);
  const requiredColumns = [mapping.identifierColumn, mapping.quantityColumn];
  if (mapping.descriptionColumn) requiredColumns.push(mapping.descriptionColumn);
  const missing = requiredColumns.filter((c) => !headerRow.includes(c));
  if (missing.length > 0) {
    throw new ValidationError(
      "REQUIRED_COLUMNS_MISSING",
      `The file is missing required columns: ${missing.join(", ")}.`,
      { missing },
    );
  }

  const rows: VendorRawRow[] = records.map((record, i) => ({
    sourceRowNumber: i + 1,
    itemNoRaw: null,
    upcRaw: mapping.identifierType === "upc" ? (record[mapping.identifierColumn] ?? null) : null,
    skuRaw: mapping.identifierType === "sku" ? (record[mapping.identifierColumn] ?? null) : null,
    descriptionRaw: mapping.descriptionColumn ? (record[mapping.descriptionColumn] ?? null) : null,
    totalQtyRaw: record[mapping.quantityColumn] ?? null,
  }));

  return { rows };
}

/** Every real .xlsx (a zip archive) starts with the "PK" local-file-header signature -- cheap, reliable way to tell it apart from a text CSV before committing to either parser. */
function isXlsxSignature(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/**
 * Same column_mapping shape as parseGenericCsv, but for a single-header-row
 * .xlsx export (first sheet only) instead of a CSV -- the UI-configured
 * "simple CSV" vendor shape now accepts either format, since both are just a
 * flat header row over named columns.
 */
async function parseGenericXlsx(buffer: Buffer, mapping: GenericCsvColumnMapping): Promise<ParsedGenericCsv> {
  const doc = await XlsxDocument.load(buffer);
  const sheetName = doc.getSheetNames()[0];
  if (!sheetName) {
    throw new ValidationError("FILE_UNREADABLE", "The uploaded workbook contains no worksheets.");
  }

  const allRows = await doc.getRows(sheetName);
  const header = (allRows[0] ?? []).map((h) => (h ?? "").trim());

  const identifierIndex = header.indexOf(mapping.identifierColumn);
  const quantityIndex = header.indexOf(mapping.quantityColumn);
  const descriptionIndex = mapping.descriptionColumn ? header.indexOf(mapping.descriptionColumn) : -1;

  const missing: string[] = [];
  if (identifierIndex < 0) missing.push(mapping.identifierColumn);
  if (quantityIndex < 0) missing.push(mapping.quantityColumn);
  if (mapping.descriptionColumn && descriptionIndex < 0) missing.push(mapping.descriptionColumn);
  if (missing.length > 0) {
    throw new ValidationError(
      "REQUIRED_COLUMNS_MISSING",
      `The file is missing required columns: ${missing.join(", ")}.`,
      { missing },
    );
  }

  const rows: VendorRawRow[] = [];
  for (let rowNumber = 2; rowNumber <= allRows.length; rowNumber++) {
    const dataRow = allRows[rowNumber - 1] ?? [];
    const cellText = (index: number): string | null => (index >= 0 ? (dataRow[index] ?? null) : null);

    const identifierRaw = cellText(identifierIndex);
    const descriptionRaw = cellText(descriptionIndex);
    const totalQtyRaw = cellText(quantityIndex);

    const isBlankRow = [identifierRaw, descriptionRaw, totalQtyRaw].every((v) => v === null || v.trim() === "");
    if (isBlankRow) continue;

    rows.push({
      sourceRowNumber: rowNumber - 1,
      itemNoRaw: null,
      upcRaw: mapping.identifierType === "upc" ? identifierRaw : null,
      skuRaw: mapping.identifierType === "sku" ? identifierRaw : null,
      descriptionRaw: mapping.descriptionColumn ? descriptionRaw : null,
      totalQtyRaw,
    });
  }

  if (rows.length === 0) {
    throw new ValidationError("ZERO_DATA_ROWS", "The file contains zero usable data rows.");
  }

  return { rows };
}

/**
 * Entry point used by vendorFileRegistry for 'simple_csv'-shaped vendors:
 * dispatches to the CSV or .xlsx reader based on the file's own content
 * (never the filename), so a vendor configured once via the Manage Vendors
 * form accepts either format interchangeably.
 */
export function parseGenericVendorFile(
  buffer: Buffer,
  mapping: GenericCsvColumnMapping,
): Promise<ParsedGenericCsv> | ParsedGenericCsv {
  return isXlsxSignature(buffer) ? parseGenericXlsx(buffer, mapping) : parseGenericCsv(buffer, mapping);
}
