import { normalizeUpc } from "@cozywinters/shared";
import { ValidationError } from "../errors";
import { XlsxDocument } from "./xlsxReader";

/** Worksheet name in the "Discontinued Items Notification" workbook Olliix emails us. */
const SHEET_NAME = "Discontinued Items Notification";

const UPC_ALIASES = ["UPC"];
const ITEM_NO_ALIASES = ["Item Number", "Item No"];
const DESCRIPTION_ALIASES = ["Brief Description", "Description"];
const DATE_ALIASES = ["Discontinued Date"];
const DIVISION_ALIASES = ["Division"];
const CATEGORY_ALIASES = ["Product Category", "Category"];

export interface ParsedDiscontinuedItem {
  sourceRowNumber: number;
  /** Digits-only UPC, the same normalization the reconcile engine applies to the daily feed's UPC. */
  normalizedUpc: string;
  itemNo: string | null;
  description: string | null;
  division: string | null;
  category: string | null;
  /** ISO date (YYYY-MM-DD), or null when the cell was blank/unparseable. */
  discontinuedDate: string | null;
}

export interface ParsedDiscontinuedList {
  items: ParsedDiscontinuedItem[];
  /** Rows skipped because their UPC was blank or non-numeric, with the row number for the upload message. */
  skippedRows: { sourceRowNumber: number; reason: string }[];
}

function normalizeHeader(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findColumn(normalizedHeader: string[], aliases: string[]): number {
  const wanted = aliases.map(normalizeHeader);
  return normalizedHeader.findIndex((h) => wanted.includes(h));
}

/** Excel stores dates as days since 1899-12-30 (the 1900 leap-year bug is already folded into that epoch). Returns null for anything that isn't a plausible serial or an ISO-style date. */
function toIsoDate(raw: string | null): string | null {
  const text = (raw ?? "").trim();
  if (text === "") return null;
  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function blankToNull(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
}

function findDiscontinuedSheet(sheetNames: string[]): string | null {
  const wanted = normalizeHeader(SHEET_NAME);
  return sheetNames.find((n) => normalizeHeader(n) === wanted) ?? null;
}

/**
 * Parses the "Discontinued Items Notification" workbook. UPC is the match key
 * (the daily feed's item numbers carry a suffix this list's don't, e.g. feed
 * "BR54-0308N" vs list "BR54-0308"), so Item Number is kept for display only.
 * Detection is by worksheet name plus the required headers, never the
 * filename, so a vendor inventory file can never be mistaken for this list or
 * the reverse. Rows without a usable UPC cannot match anything and are reported
 * as skipped instead of failing the whole upload.
 */
export async function parseDiscontinuedListWorkbook(buffer: Buffer): Promise<ParsedDiscontinuedList> {
  const doc = await XlsxDocument.load(buffer);
  const sheetNames = doc.getSheetNames();
  const sheetName = findDiscontinuedSheet(sheetNames);
  if (sheetName === null) {
    throw new ValidationError(
      "SHEET_NOT_FOUND",
      `Could not find the "${SHEET_NAME}" worksheet (found: ${sheetNames.map((n) => `"${n}"`).join(", ") || "no worksheets"}).`,
    );
  }

  const allRows = await doc.getRows(sheetName);
  const header = (allRows[0] ?? []).map(normalizeHeader);
  const upcIndex = findColumn(header, UPC_ALIASES);
  const itemNoIndex = findColumn(header, ITEM_NO_ALIASES);
  const descriptionIndex = findColumn(header, DESCRIPTION_ALIASES);
  const dateIndex = findColumn(header, DATE_ALIASES);
  const divisionIndex = findColumn(header, DIVISION_ALIASES);
  const categoryIndex = findColumn(header, CATEGORY_ALIASES);

  const missing: string[] = [];
  if (upcIndex < 0) missing.push(UPC_ALIASES[0]!);
  if (itemNoIndex < 0) missing.push(ITEM_NO_ALIASES[0]!);
  if (missing.length > 0) {
    throw new ValidationError("REQUIRED_COLUMNS_MISSING", `The discontinued items file is missing required columns: ${missing.join(", ")}.`, {
      missing,
    });
  }

  const cell = (dataRow: (string | null)[], index: number): string | null => (index >= 0 ? (dataRow[index] ?? null) : null);

  // Keyed by UPC so the same UPC listed twice in one file collapses to its later row (the newer statement of the same fact).
  const byUpc = new Map<string, ParsedDiscontinuedItem>();
  const skippedRows: ParsedDiscontinuedList["skippedRows"] = [];
  for (let rowNumber = 2; rowNumber <= allRows.length; rowNumber++) {
    const dataRow = allRows[rowNumber - 1] ?? [];
    const upcRaw = cell(dataRow, upcIndex);
    const itemNoRaw = cell(dataRow, itemNoIndex);
    if ((upcRaw ?? "").trim() === "" && (itemNoRaw ?? "").trim() === "") continue;

    const upc = normalizeUpc(upcRaw);
    if (!upc.valid || upc.normalized === null) {
      skippedRows.push({ sourceRowNumber: rowNumber, reason: upc.invalidReason ?? "INVALID_UPC" });
      continue;
    }
    byUpc.set(upc.normalized, {
      sourceRowNumber: rowNumber,
      normalizedUpc: upc.normalized,
      itemNo: blankToNull(itemNoRaw),
      description: blankToNull(cell(dataRow, descriptionIndex)),
      division: blankToNull(cell(dataRow, divisionIndex)),
      category: blankToNull(cell(dataRow, categoryIndex)),
      discontinuedDate: toIsoDate(cell(dataRow, dateIndex)),
    });
  }

  if (byUpc.size === 0) {
    throw new ValidationError("ZERO_DATA_ROWS", "The discontinued items file contains zero usable data rows.");
  }
  return { items: [...byUpc.values()], skippedRows };
}
