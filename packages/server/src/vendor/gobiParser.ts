import type { VendorRawRow } from "@cozywinters/shared";
import { ValidationError } from "../errors";
import { XlsxDocument } from "./xlsxReader";

/** The original (pre-October-2026) worksheet name. The newer export uses a differently worded, oddly padded name, so sheet lookup falls back -- see resolveSheetName(). */
const LEGACY_SHEET = "Custom Main Inventory Report";

/**
 * Header aliases per logical column, compared after normalizeHeader() (case,
 * spacing and punctuation insensitive) -- NOT fuzzy-matched. Gobi has already
 * renamed columns once without notice (the 2026-10-24 report), so each
 * variant we have actually seen is listed explicitly; a required column that
 * matches none of its aliases fails the upload with a clear message instead of
 * guessing, since a wrong guess would put wrong stock numbers into Miva.
 */
const ID_ALIASES = [
  "Gobi Heat ID",
  // The legacy file spells this "Gobo" -- a known misspelling, treated as a configured alias.
  "Gobo Heat ID (internal use only)",
  // The 2026-10-24 report renamed the ID column; it now carries the same value as Ordering SKU.
  "GOBI SKU",
];
const SKU_ALIASES = ["Ordering SKU"];
const DESCRIPTION_ALIASES = ["Description"];
const QTY_ALIASES = [
  "Remaining after reservations including BOM units OhioWarehouse sum",
  // 2026-10-24 report.
  "QTY Available",
  "Quantity Available",
];
/** Optional: absent from the legacy file. When missing, every row is simply treated as Active. */
const PHASE_ALIASES = ["Product Phase"];

export interface ParsedGobiWorkbook {
  rows: VendorRawRow[];
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

/**
 * Picks the worksheet to read: the legacy name when present, else a sheet whose
 * name still looks like the main inventory report, else the workbook's only
 * sheet. Anything else is ambiguous and rejected.
 */
function resolveSheetName(sheetNames: string[]): string | null {
  if (sheetNames.includes(LEGACY_SHEET)) return LEGACY_SHEET;
  const byNormalized = sheetNames.find((n) => normalizeHeader(n) === normalizeHeader(LEGACY_SHEET));
  if (byNormalized) return byNormalized;
  const looksLikeMain = sheetNames.filter((n) => normalizeHeader(n).includes("main in"));
  if (looksLikeMain.length === 1) return looksLikeMain[0]!;
  if (sheetNames.length === 1) return sheetNames[0]!;
  return null;
}

/**
 * Parses the Gobi Heat .xlsx export via the generic, vendor-agnostic
 * xlsxReader.ts (single header row, no OOXML quirks -- unlike Olliix's file,
 * nothing here needed a hand-rolled reader). Both the legacy format and the
 * 2026-10-24 format (renamed ID/quantity headers, new "Product Phase" column,
 * inline strings, renamed worksheet) are accepted. Blank/duplicate Ordering
 * SKU rows are not filtered here: the rule engine's own matching
 * (reconcile.ts) already flags those as BLOCKED exceptions via the sku-to-mpn
 * match strategy, the same mechanism Olliix/K&H get for blank/duplicate UPC.
 */
export async function parseGobiWorkbook(buffer: Buffer): Promise<ParsedGobiWorkbook> {
  const doc = await XlsxDocument.load(buffer);
  const sheetNames = doc.getSheetNames();
  const sheetName = resolveSheetName(sheetNames);
  if (sheetName === null) {
    throw new ValidationError(
      "SHEET_NOT_FOUND",
      `Could not identify the Gobi inventory worksheet in the uploaded workbook (found: ${sheetNames.map((n) => `"${n}"`).join(", ") || "no worksheets"}).`,
    );
  }

  const allRows = await doc.getRows(sheetName);
  const header = (allRows[0] ?? []).map(normalizeHeader);

  const idIndex = findColumn(header, ID_ALIASES);
  const skuIndex = findColumn(header, SKU_ALIASES);
  const descriptionIndex = findColumn(header, DESCRIPTION_ALIASES);
  const qtyIndex = findColumn(header, QTY_ALIASES);
  const phaseIndex = findColumn(header, PHASE_ALIASES);

  const missing: string[] = [];
  if (idIndex < 0) missing.push(ID_ALIASES[0]!);
  if (skuIndex < 0) missing.push(SKU_ALIASES[0]!);
  if (descriptionIndex < 0) missing.push(DESCRIPTION_ALIASES[0]!);
  if (qtyIndex < 0) missing.push(QTY_ALIASES[1]!);
  if (missing.length > 0) {
    throw new ValidationError(
      "REQUIRED_COLUMNS_MISSING",
      `The Gobi file is missing required columns: ${missing.join(", ")}.`,
      { missing },
    );
  }

  const rows: VendorRawRow[] = [];
  for (let rowNumber = 2; rowNumber <= allRows.length; rowNumber++) {
    const dataRow = allRows[rowNumber - 1] ?? [];
    const cellText = (index: number): string | null => dataRow[index] ?? null;

    const itemNoRaw = cellText(idIndex);
    const skuRaw = cellText(skuIndex);
    const descriptionRaw = cellText(descriptionIndex);
    const totalQtyRaw = cellText(qtyIndex);
    const productPhaseRaw = phaseIndex >= 0 ? cellText(phaseIndex) : null;

    const isBlankRow = [itemNoRaw, skuRaw, descriptionRaw, totalQtyRaw].every((v) => v === null || v.trim() === "");
    if (isBlankRow) continue;

    rows.push({
      sourceRowNumber: rowNumber,
      itemNoRaw,
      upcRaw: null,
      skuRaw,
      descriptionRaw,
      totalQtyRaw,
      productPhaseRaw,
    });
  }

  if (rows.length === 0) {
    throw new ValidationError("ZERO_DATA_ROWS", "The Gobi file contains zero usable data rows.");
  }

  return { rows };
}
