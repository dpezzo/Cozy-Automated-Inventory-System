import type { BatchCsvRow } from "@cozywinters/shared";
import { getRepository } from "../db";
import { readStoredFileText } from "../storage/fileStorage";
import { readBatchCsv } from "../domain/batchCsvIO";
import { ValidationError } from "../errors";
import { callMivaApi } from "./mivaApiClient";
import { buildCustomFieldValuesPayload, readCustomFieldValue, type MivaLogicalField } from "./mivaFieldMap";

export interface PushRowResult {
  productCode: string;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface PushBatchResult {
  pushed: number;
  failed: number;
  verificationMismatches: number;
  results: PushRowResult[];
}

/** Miva's own guidance: split large multi-call requests into manageable chunks rather than one giant call. */
const CHUNK_SIZE = 100;
/** Audit log detail cap so an unusually large batch never produces an unbounded audit_log row. */
const MAX_RESULTS_IN_AUDIT_LOG = 500;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toCustomFieldValues(row: BatchCsvRow): Record<string, Record<string, string>> {
  return buildCustomFieldValuesPayload({
    simpleInventory: row["*CUSTOM_SIMPLE_INVENTORY"],
    availability: row["*DF-AVAILABILITY"],
    restockMessage: row["*ORD-INV_RESTOCK_DATE_DF-MERG-IN:"],
    dataFeed: row["*DF-DATAFEED"],
    shoppingFeed: row["*DF-SHOPPING_FEED"],
    reportFlag: row["SHOW_IN_DARREN_INVENTORY_REPORT_(1)"],
  });
}

interface ProductUpdateIterationResult {
  success?: number;
  error_code?: string;
  error_message?: string;
}

/**
 * Maps a multicall response back to a per-row result, in request order.
 * Pure/testable in isolation from the network call itself.
 */
export function mapMulticallResults(rows: BatchCsvRow[], response: unknown): PushRowResult[] {
  // Multicall responses are a bare JSON array, one entry per iteration, in request order.
  const items = (Array.isArray(response) ? response : [response]) as ProductUpdateIterationResult[];
  return rows.map((row, i) => {
    const item = items[i];
    if (item?.success === 1) return { productCode: row.PRODUCT_CODE, success: true };
    return {
      productCode: row.PRODUCT_CODE,
      success: false,
      errorCode: item?.error_code,
      errorMessage: item?.error_message ?? "No response returned for this row.",
    };
  });
}

/** Pushes one chunk's worth of rows as a single Product_Update multicall (Iterations) request. */
async function pushChunk(rows: BatchCsvRow[]): Promise<PushRowResult[]> {
  const response = await callMivaApi({
    Function: "Product_Update",
    Iterations: rows.map((row) => ({
      Product_Code: row.PRODUCT_CODE,
      CustomField_Values: toCustomFieldValues(row),
    })),
  });
  return mapMulticallResults(rows, response);
}

const VERIFIED_FIELDS: [MivaLogicalField, keyof BatchCsvRow][] = [
  ["simpleInventory", "*CUSTOM_SIMPLE_INVENTORY"],
  ["availability", "*DF-AVAILABILITY"],
  ["restockMessage", "*ORD-INV_RESTOCK_DATE_DF-MERG-IN:"],
  ["dataFeed", "*DF-DATAFEED"],
  ["shoppingFeed", "*DF-SHOPPING_FEED"],
  ["reportFlag", "SHOW_IN_DARREN_INVENTORY_REPORT_(1)"],
];

interface ProductListItem {
  code: string;
  CustomField_Values?: Record<string, Record<string, unknown>>;
}

/**
 * Re-fetches every successfully-pushed product code and confirms each
 * intended field's value actually landed in Miva -- never trusts a
 * success:1 response alone. Returns the count of rows with at least one
 * field that doesn't match what was pushed.
 */
async function verifyPushedRows(rows: BatchCsvRow[]): Promise<number> {
  let mismatches = 0;
  for (const group of chunk(rows, CHUNK_SIZE)) {
    const codes = group.map((r) => r.PRODUCT_CODE).join(",");
    const response = await callMivaApi({
      Function: "ProductList_Load_Query",
      Count: group.length,
      Offset: 0,
      Filter: [
        { name: "search", value: [{ field: "code", operator: "IN", value: codes }] },
        { name: "ondemandcolumns", value: ["CustomField_Values:*"] },
      ],
    });
    const data = (response as { data?: { data?: ProductListItem[] } }).data?.data ?? [];
    const byCode = new Map(data.map((p) => [p.code, p]));

    for (const row of group) {
      const product = byCode.get(row.PRODUCT_CODE);
      if (!product) {
        mismatches++;
        continue;
      }
      const hasMismatch = VERIFIED_FIELDS.some(([logicalField, physicalKey]) => {
        const actual = readCustomFieldValue(product.CustomField_Values, logicalField).trim();
        const expected = (row[physicalKey] ?? "").trim();
        return actual !== expected;
      });
      if (hasMismatch) mismatches++;
    }
  }
  return mismatches;
}

/**
 * Pushes an already-generated, immutable batch's Update CSV rows directly to
 * Miva via Product_Update, instead of (or in addition to) manually importing
 * the CSV. Reads the exact same frozen data the CSV download uses, so both
 * outputs always come from one approved change set.
 */
export async function pushBatchToMiva(
  batchId: string,
  userId: string,
  confirmProduction: boolean,
): Promise<PushBatchResult> {
  const repo = getRepository();
  const batch = await repo.findBatchById(batchId);
  if (!batch || !batch.updateFileId) {
    throw new ValidationError("BATCH_INCOMPLETE", "Batch is missing its update file.");
  }

  const environment = (process.env.MIVA_ENVIRONMENT ?? "development").toLowerCase();
  if (environment === "production" && !confirmProduction) {
    throw new ValidationError(
      "PRODUCTION_CONFIRMATION_REQUIRED",
      "Pushing to the production Miva store requires explicit confirmation.",
    );
  }

  const updateFile = await repo.findFileById(batch.updateFileId);
  if (!updateFile) throw new ValidationError("FILE_NOT_FOUND", "Batch update file not found.");
  const rows = readBatchCsv(readStoredFileText(updateFile.storagePath));
  if (rows.length === 0) {
    throw new ValidationError("NO_ROWS", "This batch has no rows to push.");
  }

  const results: PushRowResult[] = [];
  for (const group of chunk(rows, CHUNK_SIZE)) {
    results.push(...(await pushChunk(group)));
  }

  const succeededRows = rows.filter((_, i) => results[i]?.success);
  const verificationMismatches = succeededRows.length > 0 ? await verifyPushedRows(succeededRows) : 0;

  const pushed = results.filter((r) => r.success).length;
  const failed = results.length - pushed;

  await repo.insertAuditLog({
    actorId: userId,
    action: failed === 0 && verificationMismatches === 0 ? "API_PUSH_SUCCEEDED" : "API_PUSH_FAILED",
    entityType: "batch",
    entityId: batchId,
    details: {
      pushed,
      failed,
      verificationMismatches,
      results: results.slice(0, MAX_RESULTS_IN_AUDIT_LOG),
    },
  });

  return { pushed, failed, verificationMismatches, results };
}
