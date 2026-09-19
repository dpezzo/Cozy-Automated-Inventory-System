import { parse } from "csv-parse/sync";
import type { VendorRawRow } from "@cozywinters/shared";
import { ValidationError } from "../errors";

const REQUIRED_HEADERS = ["SKU", "Description", "Qty Available"];

export interface ParsedFieldSheerWorkbook {
  rows: VendorRawRow[];
}

/** Parses the FieldSheer/MobileWarming CSV -- the simplest of the vendor files, a single header row with three columns. */
export function parseFieldSheerWorkbook(buffer: Buffer): ParsedFieldSheerWorkbook {
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
    throw new ValidationError("ZERO_DATA_ROWS", "The FieldSheer/MobileWarming file contains zero usable data rows.");
  }

  const headerRow = Object.keys(records[0]!);
  const missing = REQUIRED_HEADERS.filter((h) => !headerRow.includes(h));
  if (missing.length > 0) {
    throw new ValidationError(
      "REQUIRED_COLUMNS_MISSING",
      `The FieldSheer/MobileWarming file is missing required columns: ${missing.join(", ")}.`,
      { missing },
    );
  }

  const rows: VendorRawRow[] = records.map((record, i) => ({
    sourceRowNumber: i + 1,
    itemNoRaw: record["SKU"] ?? null,
    upcRaw: null,
    skuRaw: record["SKU"] ?? null,
    descriptionRaw: record["Description"] ?? null,
    totalQtyRaw: record["Qty Available"] ?? null,
  }));

  return { rows };
}
