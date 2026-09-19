import type { VendorRawRow } from "@cozywinters/shared";
import { ValidationError } from "../errors";
import { XlsxDocument } from "./xlsxReader";

const REQUIRED_SHEET = "Custom Main Inventory Report";
/** The current file spells this "Gobo Heat ID (internal use only)" -- a known misspelling, treated as a configured alias. */
const ID_ALIASES = ["Gobi Heat ID", "Gobo Heat ID (internal use only)"];
const SKU_HEADER = "Ordering SKU";
const DESCRIPTION_HEADER = "Description";
const QTY_HEADER = "Remaining after reservations including BOM units OhioWarehouse sum";

export interface ParsedGobiWorkbook {
  rows: VendorRawRow[];
}

/**
 * Parses the Gobi Heat .xlsx export via the generic, vendor-agnostic
 * xlsxReader.ts (single header row, no OOXML quirks -- unlike Olliix's file,
 * nothing here needed a hand-rolled reader). Blank/duplicate Ordering SKU
 * rows are not filtered here: the rule engine's own matching (reconcile.ts)
 * already flags those as BLOCKED exceptions via the sku-to-mpn match
 * strategy, the same mechanism Olliix/K&H get for blank/duplicate UPC.
 */
export async function parseGobiWorkbook(buffer: Buffer): Promise<ParsedGobiWorkbook> {
  const doc = await XlsxDocument.load(buffer);
  if (!doc.getSheetNames().includes(REQUIRED_SHEET)) {
    throw new ValidationError(
      "SHEET_NOT_FOUND",
      `Required worksheet "${REQUIRED_SHEET}" was not found in the uploaded workbook.`,
    );
  }

  const allRows = await doc.getRows(REQUIRED_SHEET);
  const header = (allRows[0] ?? []).map((h) => (h ?? "").trim());

  const idIndex = header.findIndex((h) => ID_ALIASES.includes(h));
  const skuIndex = header.indexOf(SKU_HEADER);
  const descriptionIndex = header.indexOf(DESCRIPTION_HEADER);
  const qtyIndex = header.indexOf(QTY_HEADER);

  const missing: string[] = [];
  if (idIndex < 0) missing.push(ID_ALIASES[0]!);
  if (skuIndex < 0) missing.push(SKU_HEADER);
  if (descriptionIndex < 0) missing.push(DESCRIPTION_HEADER);
  if (qtyIndex < 0) missing.push(QTY_HEADER);
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

    const isBlankRow = [itemNoRaw, skuRaw, descriptionRaw, totalQtyRaw].every((v) => v === null || v.trim() === "");
    if (isBlankRow) continue;

    rows.push({
      sourceRowNumber: rowNumber,
      itemNoRaw,
      upcRaw: null,
      skuRaw,
      descriptionRaw,
      totalQtyRaw,
    });
  }

  if (rows.length === 0) {
    throw new ValidationError("ZERO_DATA_ROWS", "The Gobi file contains zero usable data rows.");
  }

  return { rows };
}
