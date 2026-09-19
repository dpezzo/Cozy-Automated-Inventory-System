import { parse } from "csv-parse/sync";
import type { LegacyAuditRow } from "@cozywinters/shared";
import { ValidationError } from "../errors";

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const EXCEL_SERIAL_DATE = /^\d{4,6}$/;

/**
 * The legacy Power Query export sometimes stores "Expected Date" as a raw
 * Excel serial day count (e.g. "46310") rather than MM/DD/YYYY text, because
 * its own CSV export step did not force text formatting on that column. This
 * is a legacy export quirk, not a business-rule difference, so it is
 * normalized here to the same MM/DD/YYYY representation the MVP uses,
 * preventing a false UNEXPLAINED_DIFFERENCE during legacy comparison.
 */
function normalizeLegacyExpectedDate(raw: string | null): string | null {
  if (raw === null || raw.trim() === "") return null;
  const trimmed = raw.trim();
  if (!EXCEL_SERIAL_DATE.test(trimmed)) return trimmed;

  const serial = Number(trimmed);
  // Excel's 1900 date system epoch, using the conventional Dec 30 1899 base
  // that also correctly reproduces Excel's fictitious Feb 29 1900 leap bug.
  const epochMs = Date.UTC(1899, 11, 30);
  const date = new Date(epochMs + serial * 24 * 60 * 60 * 1000);
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${date.getUTCFullYear()}`;
}

const REQUIRED_HEADERS = [
  "SKU",
  "UPC",
  "PRODUCT_CODE",
  "Expected Date",
  "Expected Date Source",
  "*CUSTOM_SIMPLE_INVENTORY",
  "*DF-AVAILABILITY",
  "*ORD-INV_RESTOCK_DATE_DF-MERG-IN:",
  "*DF-DATAFEED",
  "*DF-SHOPPING_FEED",
  "SHOW_IN_DARREN_INVENTORY_REPORT_(1)",
];

export function parseLegacyAuditCsv(fileContent: string): LegacyAuditRow[] {
  let records: Record<string, string>[];
  try {
    records = parse(stripBom(fileContent), { columns: true, skip_empty_lines: true, bom: true });
  } catch (err) {
    throw new ValidationError("FILE_UNREADABLE", "The legacy audit CSV could not be read.", err);
  }

  if (records.length === 0) {
    throw new ValidationError("ZERO_DATA_ROWS", "The legacy audit CSV contains zero usable data rows.");
  }

  const headerRow = Object.keys(records[0]!);
  const missing = REQUIRED_HEADERS.filter((h) => !headerRow.includes(h));
  if (missing.length > 0) {
    throw new ValidationError(
      "REQUIRED_COLUMNS_MISSING",
      `The legacy audit CSV is missing required columns: ${missing.join(", ")}.`,
      { missing },
    );
  }

  return records.map((r) => ({
    sku: (r["SKU"] ?? "").trim() || null,
    upcRaw: (r["UPC"] ?? "").trim() || null,
    description: r["Brief Description"] ?? null,
    productCode: (r["PRODUCT_CODE"] ?? "").trim() || null,
    expectedDateRaw: normalizeLegacyExpectedDate(r["Expected Date"] ?? null),
    expectedDateSourceRaw: (r["Expected Date Source"] ?? "").trim() || null,
    simpleInventory: r["*CUSTOM_SIMPLE_INVENTORY"] ?? "",
    availability: r["*DF-AVAILABILITY"] ?? "",
    restockMessage: r["*ORD-INV_RESTOCK_DATE_DF-MERG-IN:"] ?? "",
    dataFeed: r["*DF-DATAFEED"] ?? "",
    shoppingFeed: r["*DF-SHOPPING_FEED"] ?? "",
    reportFlag: r["SHOW_IN_DARREN_INVENTORY_REPORT_(1)"] ?? "",
  }));
}
