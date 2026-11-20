import { ValidationError } from "../errors";
import { XlsxDocument } from "./xlsxReader";

/** Worksheet name in the "Running change SKU list" workbook Olliix sends. */
const SHEET_NAME = "SKU Changes";

export interface RunningChangeRow {
  sourceRowNumber: number;
  /** Olliix column A, kept verbatim (e.g. "1A - ADD NEW SKU NOW (old SKU sold out)"). */
  actionText: string;
  /** Tier code taken from the start of actionText: "1A", "1B", "1C", "2" or "3". Empty when unrecognized. */
  tier: string;
  oldSku: string;
  newSku: string;
  upcRaw: string;
  product: string;
  mivaProductCodeHint: string;
  oldStock: string;
  newStock: string;
  packQty: string;
  notes: string;
}

function norm(h: string | null | undefined): string {
  return (h ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The sheet carries an HTML-escaped arrow ("1 &#8594; 4"); show it as plain "to". */
function cleanText(v: string | null | undefined): string {
  return (v ?? "").replace(/&#8594;/g, "to").replace(/\s+/g, " ").trim();
}

export async function parseRunningChangeWorkbook(buffer: Buffer): Promise<RunningChangeRow[]> {
  const doc = await XlsxDocument.load(buffer);
  if (!doc.getSheetNames().includes(SHEET_NAME)) {
    throw new ValidationError("SHEET_NOT_FOUND", `The running change workbook has no "${SHEET_NAME}" sheet.`);
  }
  const grid = await doc.getRows(SHEET_NAME);
  const header = (grid[0] ?? []).map(norm);
  const col = (...names: string[]): number => header.findIndex((h) => names.map(norm).includes(h));
  const idx = {
    action: col("Action needed"),
    oldSku: col("Your SKU (current)"),
    newSku: col("New SKU"),
    upc: col("UPC (same on both)", "UPC"),
    product: col("Product"),
    code: col("Your product code(s)"),
    oldStock: col("Old SKU stock"),
    newStock: col("New SKU stock"),
    pack: header.findIndex((h) => h.startsWith("pack qty")),
    notes: col("Notes"),
  };
  for (const [name, i] of [
    ["Action needed", idx.action],
    ["Your SKU (current)", idx.oldSku],
    ["New SKU", idx.newSku],
    ["UPC", idx.upc],
  ] as const) {
    if (i < 0) throw new ValidationError("REQUIRED_COLUMN_MISSING", `The running change sheet is missing the "${name}" column.`);
  }
  const rows: RunningChangeRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const get = (i: number) => (i >= 0 ? cleanText(row[i]) : "");
    const oldSku = get(idx.oldSku);
    const newSku = get(idx.newSku);
    if (!oldSku && !newSku) continue;
    const actionText = get(idx.action);
    const tier = /^\s*([0-9][A-C]?)\b/i.exec(actionText)?.[1]?.toUpperCase() ?? "";
    rows.push({
      sourceRowNumber: r + 1,
      actionText,
      tier,
      oldSku,
      newSku,
      upcRaw: get(idx.upc),
      product: get(idx.product),
      mivaProductCodeHint: get(idx.code),
      oldStock: get(idx.oldStock),
      newStock: get(idx.newStock),
      packQty: get(idx.pack),
      notes: get(idx.notes),
    });
  }
  return rows;
}
