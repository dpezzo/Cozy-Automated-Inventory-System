import type { VendorRawRow } from "@cozywinters/shared";
import { ValidationError } from "../errors";
import { XlsxDocument } from "./xlsxReader";

/**
 * Parser version 2 for the Gobi Heat inventory workbook: the layout Gobi switched to on 2026-11-06
 * ("Inventory_Report_YYYYMMDD.xlsx"). Columns: Product ID, UPC, Style, Description, QTY Available,
 * Wholesale Price, Product Phase. There is no "Ordering SKU" column any more; Product ID plays that role
 * (on the 2026-11-21 file it matches Miva's MPN on 487 of 797 rows, where UPC matches GTIN on only 131).
 * Gobi's UPC column is deliberately NOT carried: Gobi stays on sku-to-mpn matching, and the file has
 * duplicate UPCs, so a UPC key would only add false blockers.
 *
 * Version 1 (gobiParser.ts) requires "Ordering SKU" and this version requires "Product ID", so a file only
 * ever fits one of them; that is what makes the active-then-fallback selection safe.
 */
const ID_ALIASES = ["Product ID"];
const DESCRIPTION_ALIASES = ["Description"];
const QTY_ALIASES = ["QTY Available", "Quantity Available"];
const PHASE_ALIASES = ["Product Phase"];

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

/** The new sheet is named " Custom  Cozy Winters Available" (padded). Accept the only sheet, or the one that looks like it. */
function resolveSheetName(sheetNames: string[]): string | null {
  if (sheetNames.length === 1) return sheetNames[0]!;
  const matches = sheetNames.filter((n) => normalizeHeader(n).includes("cozy winters"));
  return matches.length === 1 ? matches[0]! : null;
}

export async function parseGobiWorkbookV2(buffer: Buffer): Promise<{ rows: VendorRawRow[] }> {
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
  const descriptionIndex = findColumn(header, DESCRIPTION_ALIASES);
  const qtyIndex = findColumn(header, QTY_ALIASES);
  const phaseIndex = findColumn(header, PHASE_ALIASES);

  const missing: string[] = [];
  if (idIndex < 0) missing.push(ID_ALIASES[0]!);
  if (descriptionIndex < 0) missing.push(DESCRIPTION_ALIASES[0]!);
  if (qtyIndex < 0) missing.push(QTY_ALIASES[0]!);
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

    const productIdRaw = cellText(idIndex);
    const descriptionRaw = cellText(descriptionIndex);
    const totalQtyRaw = cellText(qtyIndex);
    const productPhaseRaw = phaseIndex >= 0 ? cellText(phaseIndex) : null;

    const isBlankRow = [productIdRaw, descriptionRaw, totalQtyRaw].every((v) => v === null || v.trim() === "");
    if (isBlankRow) continue;

    rows.push({
      sourceRowNumber: rowNumber,
      itemNoRaw: productIdRaw,
      upcRaw: null,
      skuRaw: productIdRaw,
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
