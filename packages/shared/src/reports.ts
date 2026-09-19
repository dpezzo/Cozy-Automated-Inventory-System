import type { ReconciliationRow } from "./types";

/** Deterministic display order: natural vendor source-row order, Miva-only rows last. */
export function sortForReview(rows: ReconciliationRow[]): ReconciliationRow[] {
  return [...rows].sort((a, b) => {
    const aKey = a.sourceRowNumber ?? Number.MAX_SAFE_INTEGER;
    const bKey = b.sourceRowNumber ?? Number.MAX_SAFE_INTEGER;
    if (aKey !== bKey) return aKey - bKey;
    return (a.productCode ?? "").localeCompare(b.productCode ?? "");
  });
}

/** Deterministic batch order per MVP_CSV_Contracts.md section 1: by product code, stable tie-breaker. */
export function sortForBatch(rows: ReconciliationRow[]): ReconciliationRow[] {
  return [...rows].sort((a, b) => {
    const codeCompare = (a.productCode ?? "").localeCompare(b.productCode ?? "");
    if (codeCompare !== 0) return codeCompare;
    return (a.sourceRowNumber ?? 0) - (b.sourceRowNumber ?? 0);
  });
}

export interface ExceptionRowView {
  sourceRowNumber: number | null;
  itemNo: string | null;
  productCode: string | null;
  severity: "WARNING" | "BLOCKED";
  reasonCodes: string;
  approvalEligibility: "NEVER" | "INDIVIDUAL_WITH_ACK";
}

export function toExceptionRows(rows: ReconciliationRow[]): ExceptionRowView[] {
  return sortForReview(rows)
    .filter((r) => r.reviewClass === "WARNING" || r.reviewClass === "BLOCKED")
    .map((r) => {
      const severity: "WARNING" | "BLOCKED" = r.reviewClass === "WARNING" ? "WARNING" : "BLOCKED";
      const codes = severity === "WARNING" ? r.warningCodes : r.blockerCodes;
      return {
        sourceRowNumber: r.sourceRowNumber,
        itemNo: r.itemNo,
        productCode: r.productCode,
        severity,
        reasonCodes: codes.join(","),
        approvalEligibility: severity === "WARNING" ? "INDIVIDUAL_WITH_ACK" : "NEVER",
      };
    });
}

export const UPDATE_ROLLBACK_HEADERS = [
  "PRODUCT_CODE",
  "*CUSTOM_SIMPLE_INVENTORY",
  "*DF-AVAILABILITY",
  "*ORD-INV_RESTOCK_DATE_DF-MERG-IN:",
  "*DF-DATAFEED",
  "*DF-SHOPPING_FEED",
  "SHOW_IN_DARREN_INVENTORY_REPORT_(1)",
] as const;

export interface BatchCsvRow {
  PRODUCT_CODE: string;
  "*CUSTOM_SIMPLE_INVENTORY": string;
  "*DF-AVAILABILITY": string;
  "*ORD-INV_RESTOCK_DATE_DF-MERG-IN:": string;
  "*DF-DATAFEED": string;
  "*DF-SHOPPING_FEED": string;
  "SHOW_IN_DARREN_INVENTORY_REPORT_(1)": string;
}

/** Rows for the immutable Miva update CSV: complete calculated (proposed) managed state. */
export function toUpdateBatchRows(approvedChangedRows: ReconciliationRow[]): BatchCsvRow[] {
  return sortForBatch(approvedChangedRows).map((r) => ({
    PRODUCT_CODE: r.productCode ?? "",
    "*CUSTOM_SIMPLE_INVENTORY": r.proposed.simpleInventory ?? "",
    "*DF-AVAILABILITY": r.proposed.availability ?? "",
    "*ORD-INV_RESTOCK_DATE_DF-MERG-IN:": r.proposed.restockMessage ?? "",
    "*DF-DATAFEED": r.proposed.dataFeed ?? "",
    "*DF-SHOPPING_FEED": r.proposed.shoppingFeed ?? "",
    "SHOW_IN_DARREN_INVENTORY_REPORT_(1)": r.proposed.reportFlag ?? "",
  }));
}

/** Rows for the paired rollback CSV: complete pre-run (current) managed state. */
export function toRollbackBatchRows(approvedChangedRows: ReconciliationRow[]): BatchCsvRow[] {
  return sortForBatch(approvedChangedRows).map((r) => ({
    PRODUCT_CODE: r.productCode ?? "",
    "*CUSTOM_SIMPLE_INVENTORY": r.current.simpleInventory ?? "",
    "*DF-AVAILABILITY": r.current.availability ?? "",
    "*ORD-INV_RESTOCK_DATE_DF-MERG-IN:": r.current.restockMessage ?? "",
    "*DF-DATAFEED": r.current.dataFeed ?? "",
    "*DF-SHOPPING_FEED": r.current.shoppingFeed ?? "",
    "SHOW_IN_DARREN_INVENTORY_REPORT_(1)": r.current.reportFlag ?? "",
  }));
}

export interface DecisionView {
  reconciliationRowId: string;
  status: "PENDING" | "APPROVED" | "APPROVED_WARNING_ACK" | "REJECTED";
  decidedAt: string | null;
  batchId: string | null;
}

/** Full reconciliation CSV row shape per MVP_CSV_Contracts.md section 6. */
export function toFullReconciliationRows(
  runId: string,
  ruleId: string,
  ruleConfigHash: string,
  entries: { row: ReconciliationRow & { id: string }; decision: DecisionView }[],
) {
  return sortForReview(entries.map((e) => e.row)).map((row) => {
    const entry = entries.find((e) => e.row.id === (row as ReconciliationRow & { id: string }).id)!;
    const r = row as ReconciliationRow & { id: string };
    return {
      RUN_ID: runId,
      RULE_ID: ruleId,
      RULE_CONFIG_HASH: ruleConfigHash,
      SOURCE_ROW_NUMBER: r.sourceRowNumber ?? "",
      ITEM_NO: r.itemNo ?? "",
      RAW_UPC: r.rawUpc ?? "",
      NORMALIZED_UPC: r.normalizedUpc ?? "",
      PRODUCT_CODE: r.productCode ?? "",
      MATCH_OUTCOME: r.matchOutcome,
      MATCH_METHOD: "EXACT_UPC_TO_GTIN",
      CURRENT_SIMPLE_INVENTORY: r.current.simpleInventory ?? "",
      PROPOSED_SIMPLE_INVENTORY: r.proposed.simpleInventory ?? "",
      CURRENT_AVAILABILITY: r.current.availability ?? "",
      PROPOSED_AVAILABILITY: r.proposed.availability ?? "",
      CURRENT_RESTOCK_MESSAGE: r.current.restockMessage ?? "",
      PROPOSED_RESTOCK_MESSAGE: r.proposed.restockMessage ?? "",
      CURRENT_DATAFEED: r.current.dataFeed ?? "",
      PROPOSED_DATAFEED: r.proposed.dataFeed ?? "",
      CURRENT_SHOPPING_FEED: r.current.shoppingFeed ?? "",
      PROPOSED_SHOPPING_FEED: r.proposed.shoppingFeed ?? "",
      CURRENT_REPORT_FLAG: r.current.reportFlag ?? "",
      PROPOSED_REPORT_FLAG: r.proposed.reportFlag ?? "",
      FIELDS_CHANGED: r.changed ? "1" : "0",
      TOTAL_QTY: r.totalQtyRaw ?? "",
      EXPECTED_DATE: r.expectedDate ?? "",
      EXPECTED_DATE_SOURCES: r.expectedDateSources.join("|"),
      REVIEW_CLASS: r.reviewClass,
      WARNING_CODES: r.warningCodes.join(","),
      BLOCKER_CODES: r.blockerCodes.join(","),
      DECISION_STATUS: entry.decision.status,
      DECISION_TIME: entry.decision.decidedAt ?? "",
      BATCH_ID: entry.decision.batchId ?? "",
    };
  });
}

export const FULL_RECONCILIATION_HEADERS = [
  "RUN_ID",
  "RULE_ID",
  "RULE_CONFIG_HASH",
  "SOURCE_ROW_NUMBER",
  "ITEM_NO",
  "RAW_UPC",
  "NORMALIZED_UPC",
  "PRODUCT_CODE",
  "MATCH_OUTCOME",
  "MATCH_METHOD",
  "CURRENT_SIMPLE_INVENTORY",
  "PROPOSED_SIMPLE_INVENTORY",
  "CURRENT_AVAILABILITY",
  "PROPOSED_AVAILABILITY",
  "CURRENT_RESTOCK_MESSAGE",
  "PROPOSED_RESTOCK_MESSAGE",
  "CURRENT_DATAFEED",
  "PROPOSED_DATAFEED",
  "CURRENT_SHOPPING_FEED",
  "PROPOSED_SHOPPING_FEED",
  "CURRENT_REPORT_FLAG",
  "PROPOSED_REPORT_FLAG",
  "FIELDS_CHANGED",
  "TOTAL_QTY",
  "EXPECTED_DATE",
  "EXPECTED_DATE_SOURCES",
  "REVIEW_CLASS",
  "WARNING_CODES",
  "BLOCKER_CODES",
  "DECISION_STATUS",
  "DECISION_TIME",
  "BATCH_ID",
] as const;

export const EXCEPTION_HEADERS = [
  "SOURCE_ROW_NUMBER",
  "ITEM_NO",
  "PRODUCT_CODE",
  "SEVERITY",
  "REASON_CODES",
  "APPROVAL_ELIGIBILITY",
] as const;
