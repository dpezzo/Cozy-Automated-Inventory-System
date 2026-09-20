import { parse } from "csv-parse/sync";
import type { VendorRawRow } from "@cozywinters/shared";
import { ValidationError } from "../errors";

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
