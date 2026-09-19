import { parse } from "csv-parse/sync";
import type { VendorRawRow } from "@cozywinters/shared";
import { ValidationError } from "../errors";

const REQUIRED_HEADERS = ["Item ID", "UPC", "QOH", "Brand"];
/** The K&H CSV is a shared multi-vendor distributor feed; only this brand's rows are K&H's own. */
const TARGET_BRAND = "K&H Pet Products";

/**
 * Strips a UTF-8 BOM from a CSV record's header keys. This file's BOM sits
 * *inside* the first quoted field (`"﻿Item ID"`), not at byte 0 of the
 * file, so a file-level strip (as in vendor/mivaCsv.ts) doesn't catch it --
 * the BOM survives quote-stripping as a leading character of the key itself.
 */
function stripBomFromKeys<T extends Record<string, unknown>>(record: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const cleanKey = key.charCodeAt(0) === 0xfeff ? key.slice(1) : key;
    result[cleanKey] = value;
  }
  return result as T;
}

export interface ParsedKhWorkbook {
  rows: VendorRawRow[];
}

/**
 * Parses the K&H distributor CSV. The file's first header has a UTF-8 BOM
 * (stripped automatically by csv-parse's `bom: true`). Filters to
 * Brand === "K&H Pet Products" during parsing, so the rule engine never
 * sees the hundreds of other-brand distributor rows mixed into this file.
 */
export function parseKhWorkbook(buffer: Buffer): ParsedKhWorkbook {
  let rawRecords: Record<string, string>[];
  try {
    rawRecords = parse(buffer.toString("utf8"), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: false,
    });
  } catch (err) {
    throw new ValidationError("FILE_UNREADABLE", "The uploaded file could not be read as a CSV.", err);
  }
  const records = rawRecords.map(stripBomFromKeys);

  if (records.length === 0) {
    throw new ValidationError("ZERO_DATA_ROWS", "The K&H file contains zero usable data rows.");
  }

  const headerRow = Object.keys(records[0]!);
  const missing = REQUIRED_HEADERS.filter((h) => !headerRow.includes(h));
  if (missing.length > 0) {
    throw new ValidationError(
      "REQUIRED_COLUMNS_MISSING",
      `The K&H file is missing required columns: ${missing.join(", ")}.`,
      { missing },
    );
  }

  const rows: VendorRawRow[] = [];
  records.forEach((record, i) => {
    if ((record["Brand"] ?? "").trim() !== TARGET_BRAND) return;
    rows.push({
      sourceRowNumber: i + 1,
      itemNoRaw: record["Item ID"] ?? null,
      upcRaw: record["UPC"] ?? null,
      descriptionRaw: record["Item Name"] ?? null,
      totalQtyRaw: record["QOH"] ?? null,
    });
  });

  if (rows.length === 0) {
    throw new ValidationError("ZERO_DATA_ROWS", `No rows for brand "${TARGET_BRAND}" were found in the uploaded file.`);
  }

  return { rows };
}
