import type { ManagedValues, MivaRawRow } from "./types";
import type { BatchCsvRow } from "./reports";

export type VerificationResult = "PASS" | "FAIL";

export interface VerificationRow {
  productCode: string;
  result: VerificationResult;
  reason: string;
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function managedFromMiva(row: MivaRawRow): ManagedValues {
  return {
    simpleInventory: row.currentSimpleInventory,
    availability: row.currentAvailability,
    restockMessage: row.currentRestockMessage,
    dataFeed: row.currentDataFeed,
    shoppingFeed: row.currentShoppingFeed,
    reportFlag: row.currentReportFlag,
  };
}

function managedFromBatchRow(row: BatchCsvRow): ManagedValues {
  return {
    simpleInventory: row["*CUSTOM_SIMPLE_INVENTORY"],
    availability: row["*DF-AVAILABILITY"],
    restockMessage: row["*ORD-INV_RESTOCK_DATE_DF-MERG-IN:"],
    dataFeed: row["*DF-DATAFEED"],
    shoppingFeed: row["*DF-SHOPPING_FEED"],
    reportFlag: row["SHOW_IN_DARREN_INVENTORY_REPORT_(1)"],
  };
}

function fieldDiffs(expected: ManagedValues, actual: ManagedValues): (keyof ManagedValues)[] {
  const fields: (keyof ManagedValues)[] = [
    "simpleInventory",
    "availability",
    "restockMessage",
    "dataFeed",
    "shoppingFeed",
    "reportFlag",
  ];
  return fields.filter((f) => norm(expected[f]) !== norm(actual[f]));
}

export interface VerifyPostImportOptions {
  /** Approved batch rows (the update CSV contents), keyed implicitly by PRODUCT_CODE. */
  approvedBatchRows: BatchCsvRow[];
  /** The pre-import Miva snapshot used for this run, one row per product code. */
  preImportByProductCode: Map<string, MivaRawRow>;
  /** The freshly exported post-import Miva snapshot, one row per product code. */
  postImportByProductCode: Map<string, MivaRawRow>;
}

/**
 * Verifies a manual Miva development-store import per Olliix_MVP_Rule_Contract.md
 * section 8.2. Read-only: never mutates approvals, rules, or generated files.
 */
export function verifyPostImport(options: VerifyPostImportOptions): VerificationRow[] {
  const { approvedBatchRows, preImportByProductCode, postImportByProductCode } = options;
  const results: VerificationRow[] = [];
  const approvedCodes = new Set(approvedBatchRows.map((r) => r.PRODUCT_CODE));

  for (const batchRow of approvedBatchRows) {
    const expected = managedFromBatchRow(batchRow);
    const post = postImportByProductCode.get(batchRow.PRODUCT_CODE);
    if (!post) {
      results.push({ productCode: batchRow.PRODUCT_CODE, result: "FAIL", reason: "PRODUCT_NOT_FOUND_POST_IMPORT" });
      continue;
    }
    const actual = managedFromMiva(post);
    const diffs = fieldDiffs(expected, actual);
    if (diffs.length === 0) {
      results.push({ productCode: batchRow.PRODUCT_CODE, result: "PASS", reason: "EXPECTED_APPROVED_VALUES_PRESENT" });
    } else if (diffs.includes("restockMessage") && norm(expected.restockMessage) === "" && norm(actual.restockMessage) !== "") {
      results.push({ productCode: batchRow.PRODUCT_CODE, result: "FAIL", reason: "FAILED_TO_CLEAR_RESTOCK" });
    } else {
      results.push({ productCode: batchRow.PRODUCT_CODE, result: "FAIL", reason: "APPROVED_VALUE_MISMATCH" });
    }
  }

  // Every product outside the approved batch must be unchanged from pre-import.
  for (const [productCode, preRow] of preImportByProductCode) {
    if (approvedCodes.has(productCode)) continue;
    const post = postImportByProductCode.get(productCode);
    if (!post) continue; // Product removal is out of scope for managed-field verification.
    const diffs = fieldDiffs(managedFromMiva(preRow), managedFromMiva(post));
    if (diffs.length > 0) {
      results.push({ productCode, result: "FAIL", reason: "UNAPPROVED_PRODUCT_CHANGED" });
    }
  }

  return results;
}
