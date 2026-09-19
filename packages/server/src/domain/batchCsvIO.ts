import { parse } from "csv-parse/sync";
import { UPDATE_ROLLBACK_HEADERS, type BatchCsvRow } from "@cozywinters/shared";

/**
 * Reads a generated Update or Rollback batch CSV back into BatchCsvRow[].
 * Used wherever an already-generated, immutable batch's approved rows need
 * to be re-derived (post-import verification, Miva API push) -- never from
 * live DB rows, which are locked out of getBatchableRows once a batch exists.
 */
export function readBatchCsv(text: string): BatchCsvRow[] {
  const records: Record<string, string>[] = parse(text, { columns: true, skip_empty_lines: true });
  return records.map((r) => ({
    PRODUCT_CODE: r[UPDATE_ROLLBACK_HEADERS[0]] ?? "",
    "*CUSTOM_SIMPLE_INVENTORY": r[UPDATE_ROLLBACK_HEADERS[1]] ?? "",
    "*DF-AVAILABILITY": r[UPDATE_ROLLBACK_HEADERS[2]] ?? "",
    "*ORD-INV_RESTOCK_DATE_DF-MERG-IN:": r[UPDATE_ROLLBACK_HEADERS[3]] ?? "",
    "*DF-DATAFEED": r[UPDATE_ROLLBACK_HEADERS[4]] ?? "",
    "*DF-SHOPPING_FEED": r[UPDATE_ROLLBACK_HEADERS[5]] ?? "",
    "SHOW_IN_DARREN_INVENTORY_REPORT_(1)": r[UPDATE_ROLLBACK_HEADERS[6]] ?? "",
  }));
}
