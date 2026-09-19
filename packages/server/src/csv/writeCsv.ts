import { stringify } from "csv-stringify/sync";

const FORMULA_LEAD_CHARS = ["=", "+", "-", "@"];

/**
 * Neutralizes formula-injection-prone leading characters for CSVs intended for
 * human spreadsheet viewing, per MVP_CSV_Contracts.md section 1. Not applied to
 * Miva import batches, which must remain byte-faithful to the calculated values.
 */
export function sanitizeForSpreadsheetViewing(value: string): string {
  if (value.length === 0) return value;
  if (FORMULA_LEAD_CHARS.includes(value[0]!)) return `'${value}`;
  return value;
}

export interface WriteCsvOptions {
  sanitizeFormulas?: boolean;
}

export function rowsToCsv<T extends object>(rows: T[], headers: string[], options: WriteCsvOptions = {}): string {
  const sanitize = options.sanitizeFormulas ?? false;
  const records = rows.map((row) =>
    headers.map((h) => {
      const raw = (row as Record<string, unknown>)[h];
      const text = raw === null || raw === undefined ? "" : String(raw);
      return sanitize ? sanitizeForSpreadsheetViewing(text) : text;
    }),
  );
  return stringify([headers, ...records], { quoted_string: false });
}
