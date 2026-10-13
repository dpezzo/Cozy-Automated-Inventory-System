// Domain types for the multi-vendor reconciliation rule engine.
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

/** A per-location key in a vendor's `warehouses` breakdown -- not a closed set: only Olliix's adapter uses its own three codes (see OLLIIX_WAREHOUSE_CODES below). */
export type WarehouseCode = string;

/** Olliix's specific three warehouse codes -- used only by olliixParser.ts and Olliix-specific tests, not by the generic rule engine. */
export const OLLIIX_WAREHOUSE_CODES = ["WDC", "SD3", "SD2"] as const;

/** One raw vendor row, as read from that vendor's file by its own adapter (packages/server/src/vendor/). */
export interface VendorRawRow {
  /** 1-based row number in the source file, for traceability. */
  sourceRowNumber: number;
  itemNoRaw: string | null;
  /** Barcode-style identifier (UPC), for vendors matched via matchStrategy "upc-to-gtin" (Olliix, K&H). */
  upcRaw: string | null;
  /** SKU-style identifier, for vendors matched via matchStrategy "sku-to-mpn" (Gobi, FieldSheer/MobileWarming). */
  skuRaw?: string | null;
  descriptionRaw: string | null;
  totalQtyRaw: string | null;
  /** Per-location incoming-date/quantity evidence. Optional: only Olliix's file has this concept -- every other vendor simply omits it, and the rule engine treats that as "no expected date" rather than an error. */
  warehouses?: Record<WarehouseCode, WarehouseEvidence>;
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
  currentDsInvMgt: string;
  /** Miva's native active/inactive product flag ("1"/"0"). Informational only -- not used by matching or the rule engine. */
  active?: string;
  /** Custom field identifying this product's parent product code (for a Variant record). Informational only. */
  parentCode?: string;
  /** "Parent" (has variants), "Variant" (a parent's attribute combination), or blank/"Standard" for a normal product. Informational only -- not used by matching or the rule engine. */
  productType?: string;
  /** Storefront product page URL. For a Variant, this already resolves to its parent's page (optionally with a variant_select query string for deep-linking). Informational only. */
  productUrl?: string;
  /** Small preview image URL. Informational only. */
  thumbnailUrl?: string;
}

export interface NormalizedIdentifier {
  raw: string | null;
  normalized: string | null;
  valid: boolean;
  invalidReason?: "BLANK_UPC" | "NONNUMERIC_UPC" | "BLANK_GTIN" | "NONNUMERIC_GTIN" | "BLANK_VENDOR_SKU";
}

export type MatchOutcome =
  | "MATCHED"
  | "BLOCKED IDENTIFIER"
  | "BLOCKED DUPLICATE VENDOR KEY"
  | "BLOCKED AMBIGUOUS MIVA KEY"
  | "UNMATCHED - BRAND ELIGIBILITY UNKNOWN"
  | "MISSING - REVIEW REQUIRED"
  /** matchStrategy "upc-or-sku" only: UPC and SKU each resolved to exactly one Miva product, but not the same one. */
  | "BLOCKED IDENTIFIER MISMATCH"
  /** Only ever synthesized on demand by Run Review's "Show all Miva products" toggle (runService.ts's listUntrackedBrandRows), never persisted to reconciliation_rows -- a brand-eligible Miva product with a blank tracked flag, not referenced by any vendor row this run. Purely informational: never blocked, never eligible for approval. */
  | "IN MIVA - NOT TRACKED";

export type ReviewClass = "CLEAN" | "WARNING" | "BLOCKED" | "UNCHANGED";

export type WarningCode =
  | "WAREHOUSE_TOTAL_MISMATCH"
  | "EXPECTED_DATE_CONFLICT"
  | "DATE_WITH_NONPOSITIVE_INCOMING_QTY"
  | "INCOMING_QTY_WITHOUT_DATE"
  | "AMBIGUOUS_INCOMING_DATE"
  /** A genuine vendor match against a Miva product whose DROPSHIP_INVENTORY_MANAGEMENT is blank -- forced to WARNING so it can't be bulk-approved as CLEAN. */
  | "MIVA_NOT_DROPSHIP_TRACKED"
  /** A genuine vendor match against a Miva product currently flagged NLA (the DROPSHIP_INVENTORY_MANAGEMENT field's literal value) -- approving would reactivate a deliberately-discontinued product. */
  | "MIVA_CURRENTLY_NLA"
  /** A genuine vendor match against a Miva product whose *status* field (simpleInventory) already says "NO LONGER AVAILABLE" -- a separate field from DROPSHIP_INVENTORY_MANAGEMENT/MIVA_CURRENTLY_NLA, and not implied by it: a product can be tracked ("1") and still have this status set. Without this check such a row resolves CLEAN (eligible for bulk approval) with no indication Miva already shows it discontinued. */
  | "MIVA_MARKED_DISCONTINUED";

export type BlockerCode =
  | "BLANK_UPC"
  | "NONNUMERIC_UPC"
  | "DUPLICATE_VENDOR_UPC"
  | "DUPLICATE_MIVA_GTIN"
  | "BLANK_VENDOR_SKU"
  | "DUPLICATE_VENDOR_SKU"
  | "DUPLICATE_MIVA_MPN"
  | "BLANK_TOTAL_QTY"
  | "NEGATIVE_TOTAL_QTY"
  | "INVALID_TOTAL_QTY"
  | "NO_MIVA_MATCH"
  | "UNKNOWN_MIVA_BRAND"
  | "MISSING_FROM_VENDOR"
  /** Olliix's historical name for this same code, kept only because it's baked into the immutable, read-only bake-off fixture bundle -- new vendors use MISSING_FROM_VENDOR. */
  | "MISSING_FROM_OLLIIX"
  /** matchStrategy "upc-or-sku" only: a vendor row's UPC and SKU each cleanly resolve to exactly one Miva product, but to two DIFFERENT products -- never silently trust one over the other. */
  | "IDENTIFIER_MISMATCH";

export interface ManagedValues {
  simpleInventory: string;
  availability: string;
  restockMessage: string;
  dataFeed: string;
  shoppingFeed: string;
  dsInvMgt: string;
}

export interface ExpectedDateResult {
  date: string | null; // MM/DD/YYYY, formatted
  sources: WarehouseCode[];
  conflict: boolean;
}

/** The full computed result for a single vendor source row or Miva-only "missing" row. */
export interface ReconciliationRow {
  /** Present for vendor-sourced rows; absent for Miva-only MISSING rows. */
  sourceRowNumber: number | null;
  itemNo: string | null;
  /** The raw matching identifier as read from the vendor file -- a UPC for barcode-matched vendors, a SKU for sku-matched vendors. Field name kept as "rawUpc" for compatibility with existing DB columns/reports/UI; holds whichever identifier that vendor actually matches on. */
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

/** One vendor's full rule configuration. See packages/shared/src/vendorRegistry.ts for the actual per-vendor instances. */
export interface VendorRuleConfig {
  ruleId: string;
  vendorLabel: string;
  inStockThreshold: number;
  timezone: string;
  /** Miva-side filter: only Miva products in one of these brands are eligible matches. */
  brandAllowlist: string[];
  /** Which identifier pair this vendor matches on. "upc-to-gtin" reads row.upcRaw against Miva gtinRaw; "sku-to-mpn" reads row.skuRaw against Miva mpnRaw; "upc-or-sku" checks both independently (see reconcile.ts's reconcileDual) -- whichever resolves confidently is used, and a clean match on both to two different products is a hard block rather than a silent pick. */
  matchStrategy: "upc-to-gtin" | "sku-to-mpn" | "upc-or-sku";
  /** Blocker code for "Miva product missing from this vendor's file". Defaults to MISSING_FROM_VENDOR; Olliix pins its historical MISSING_FROM_OLLIIX to stay byte-identical with the immutable bake-off fixture bundle. */
  missingBlockerCode?: BlockerCode;
}
