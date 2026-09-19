// Domain types for the Olliix reconciliation rule engine.
// Kept free of any I/O, HTTP, or persistence concerns so the engine is
// independently testable and portable to a future worker process.

export interface WarehouseEvidence {
  /** Raw inventory quantity cell value, as text, e.g. "6" */
  invQtyRaw: string | null;
  /** Raw incoming date cell value, as text, e.g. "10/15/2026" */
  incomingDateRaw: string | null;
  /** Raw incoming quantity cell value, as text, e.g. "20" */
  incomingQtyRaw: string | null;
}

export const WAREHOUSE_CODES = ["WDC", "SD3", "SD2"] as const;
export type WarehouseCode = (typeof WAREHOUSE_CODES)[number];

/** One raw Olliix vendor row, as read from the two-header-row worksheet. */
export interface OlliixRawRow {
  /** 1-based row number in the worksheet, matching Excel's own row numbering. */
  sourceRowNumber: number;
  itemNoRaw: string | null;
  upcRaw: string | null;
  descriptionRaw: string | null;
  totalQtyRaw: string | null;
  warehouses: Record<WarehouseCode, WarehouseEvidence>;
}

/** One raw Miva catalog row, as read from the snapshot CSV. */
export interface MivaRawRow {
  /** 1-based data row number in the CSV (header excluded), for traceability. */
  sourceRowNumber: number;
  productCode: string;
  productName: string;
  gtinRaw: string | null;
  mpnRaw: string | null;
  brandRaw: string | null;
  currentSimpleInventory: string;
  currentAvailability: string;
  currentRestockMessage: string;
  currentDataFeed: string;
  currentShoppingFeed: string;
  currentReportFlag: string;
}

export interface NormalizedIdentifier {
  raw: string | null;
  normalized: string | null;
  valid: boolean;
  invalidReason?: "BLANK_UPC" | "NONNUMERIC_UPC" | "BLANK_GTIN" | "NONNUMERIC_GTIN";
}

export type MatchOutcome =
  | "MATCHED"
  | "BLOCKED IDENTIFIER"
  | "BLOCKED DUPLICATE VENDOR KEY"
  | "BLOCKED AMBIGUOUS MIVA KEY"
  | "UNMATCHED - BRAND ELIGIBILITY UNKNOWN"
  | "MISSING - REVIEW REQUIRED";

export type ReviewClass = "CLEAN" | "WARNING" | "BLOCKED" | "UNCHANGED";

export type WarningCode =
  | "WAREHOUSE_TOTAL_MISMATCH"
  | "EXPECTED_DATE_CONFLICT"
  | "DATE_WITH_NONPOSITIVE_INCOMING_QTY"
  | "INCOMING_QTY_WITHOUT_DATE"
  | "AMBIGUOUS_INCOMING_DATE";

export type BlockerCode =
  | "BLANK_UPC"
  | "NONNUMERIC_UPC"
  | "DUPLICATE_VENDOR_UPC"
  | "DUPLICATE_MIVA_GTIN"
  | "BLANK_TOTAL_QTY"
  | "NEGATIVE_TOTAL_QTY"
  | "INVALID_TOTAL_QTY"
  | "NO_MIVA_MATCH"
  | "UNKNOWN_MIVA_BRAND"
  | "MISSING_FROM_OLLIIX";

export interface ManagedValues {
  simpleInventory: string;
  availability: string;
  restockMessage: string;
  dataFeed: string;
  shoppingFeed: string;
  reportFlag: string;
}

export interface ExpectedDateResult {
  date: string | null; // MM/DD/YYYY, formatted
  sources: WarehouseCode[];
  conflict: boolean;
}

/** The full computed result for a single Olliix source row or Miva-only "missing" row. */
export interface ReconciliationRow {
  /** Present for vendor-sourced rows; absent for Miva-only MISSING rows. */
  sourceRowNumber: number | null;
  itemNo: string | null;
  rawUpc: string | null;
  normalizedUpc: string | null;
  description: string | null;
  /** Pipe-joined when ambiguous, single value otherwise, null when no Miva product identified. */
  productCode: string | null;
  matchOutcome: MatchOutcome;
  reviewClass: ReviewClass;
  warningCodes: WarningCode[];
  blockerCodes: BlockerCode[];
  totalQtyRaw: string | null;
  expectedDate: string | null;
  expectedDateSources: WarehouseCode[];
  current: Partial<ManagedValues>;
  proposed: Partial<ManagedValues>;
  changed: boolean;
  /** True only for MATCHED rows with a valid, non-negative numeric total quantity. */
  isEligibleForApproval: boolean;
}

export interface OlliixRuleConfig {
  ruleId: string;
  inStockThreshold: number;
  timezone: string;
  brandAllowlist: string[];
}
