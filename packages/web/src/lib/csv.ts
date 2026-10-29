/**
 * Builds a CSV that opens correctly in Excel and Google Sheets.
 *
 * Two spreadsheet traps are handled here, both of which matter for catalog data:
 * - Excel turns a long digit string into a number, dropping leading zeros and rounding past 15 digits, which silently
 *   corrupts a UPC/GTIN like 022164437034. Digit-only values of 8+ characters (or with a leading zero) are written as
 *   ="022164437034", which Excel and Sheets both show as the exact text.
 * - A text cell starting with = + - or @ is read as a formula, so such values (a product name that starts with "-", say)
 *   get a leading apostrophe instead of being executed. Plain numbers, including negative ones, are left alone.
 */
const PLAIN_NUMBER = /^[-+]?\d+(\.\d+)?$/;
const DIGITS_ONLY = /^\d+$/;

export function csvCell(raw: string): string {
  let value = raw;
  if (DIGITS_ONLY.test(value) && (value.length >= 8 || (value.length > 1 && value.startsWith("0")))) {
    return `="${value}"`;
  }
  if (/^[=+\-@\t\r]/.test(value) && !PLAIN_NUMBER.test(value)) value = `'${value}`;
  if (/[",\r\n]/.test(value)) value = `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** UTF-8 with a byte order mark, so Excel reads accented characters correctly; CRLF line endings. */
export function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((cells) => cells.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Saves text as a file through the browser, with no server round trip. */
export function downloadTextFile(filename: string, content: string, mimeType = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
