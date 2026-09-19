import {
  toUpdateBatchRows,
  toRollbackBatchRows,
  toExceptionRows,
  toFullReconciliationRows,
  UPDATE_ROLLBACK_HEADERS,
  EXCEPTION_HEADERS,
  FULL_RECONCILIATION_HEADERS,
} from "@cozywinters/shared";
import { getRepository, type BatchRecord } from "../db";
import { ValidationError } from "../errors";
import { saveGeneratedFile } from "../storage/fileStorage";
import { rowsToCsv } from "../csv/writeCsv";
import { getBatchableRows } from "./runService";

/** Formats a run's YYYY-MM-DD run date as MMDDYY, matching the operator's own file-naming convention. */
function formatRunDateMMDDYY(runDate: string): string {
  const [year, month, day] = runDate.split("-");
  return `${month}${day}${(year ?? "").slice(2)}`;
}

/**
 * Derives the vendor slug used in generated filenames from the run's own
 * pinned rule identifier (e.g. "olliix-inventory-v1" -> "olliix"), rather
 * than hardcoding a vendor name here. Rule identifiers follow the
 * "<vendor>-inventory-v<N>" convention (Olliix_MVP_Rule_Contract.md
 * section 1), so a future vendor's rule module (e.g. "kh-inventory-v1")
 * produces correctly-prefixed filenames automatically, with no change to
 * batch generation.
 */
function vendorSlugFromRuleId(ruleId: string): string {
  const match = /^([a-z0-9]+)-inventory-/i.exec(ruleId);
  if (match) return match[1]!.toLowerCase();
  const firstSegment = ruleId.split("-")[0] ?? ruleId;
  return firstSegment.toLowerCase().replace(/[^a-z0-9]/g, "") || "vendor";
}

/**
 * Generates the four immutable batch files from currently approved, changed,
 * unlocked rows and freezes their decisions. A generated batch never changes;
 * later approvals form a new batch instead.
 */
export async function generateBatch(runId: string, userId: string): Promise<BatchRecord> {
  const repo = getRepository();
  const run = await repo.findRunById(runId);
  if (!run) throw new ValidationError("RUN_NOT_FOUND", "Run not found.");
  if (run.status !== "ready") {
    throw new ValidationError("RUN_NOT_READY", "The run must be in the ready state to generate a batch.");
  }

  const batchable = await getBatchableRows(runId);
  if (batchable.length === 0) {
    throw new ValidationError(
      "NO_APPROVED_ROWS",
      "There are no approved, changed, unlocked rows eligible to include in a batch.",
    );
  }

  const approvedRows = batchable.map((v) => v.row);
  const updateRows = toUpdateBatchRows(approvedRows);
  const rollbackRows = toRollbackBatchRows(approvedRows);

  const allRows = await repo.listRunRows(runId);
  const exceptionRows = toExceptionRows(allRows.map((v) => v.row)).map((r) => ({
    SOURCE_ROW_NUMBER: r.sourceRowNumber ?? "",
    ITEM_NO: r.itemNo ?? "",
    PRODUCT_CODE: r.productCode ?? "",
    SEVERITY: r.severity,
    REASON_CODES: r.reasonCodes,
    APPROVAL_ELIGIBILITY: r.approvalEligibility,
  }));
  const fullReconciliationRows = toFullReconciliationRows(
    runId,
    run.ruleId,
    run.ruleConfigHash,
    allRows.map((v) => ({ row: v.row, decision: v.decision })),
  );

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const updateFile = saveGeneratedFile(
    rowsToCsv(updateRows, [...UPDATE_ROLLBACK_HEADERS]),
    "generated_batch",
    `${runId}_update_${timestamp}.csv`,
  );
  const rollbackFile = saveGeneratedFile(
    rowsToCsv(rollbackRows, [...UPDATE_ROLLBACK_HEADERS]),
    "generated_batch",
    `${runId}_rollback_${timestamp}.csv`,
  );
  const exceptionFile = saveGeneratedFile(
    rowsToCsv(exceptionRows, [...EXCEPTION_HEADERS], { sanitizeFormulas: true }),
    "generated_batch",
    `${runId}_exceptions_${timestamp}.csv`,
  );
  const reconciliationFile = saveGeneratedFile(
    rowsToCsv(fullReconciliationRows, [...FULL_RECONCILIATION_HEADERS], { sanitizeFormulas: true }),
    "generated_batch",
    `${runId}_reconciliation_${timestamp}.csv`,
  );

  const dateSuffix = formatRunDateMMDDYY(run.runDate);
  const vendorSlug = vendorSlugFromRuleId(run.ruleId);
  const updateFileRecord = await repo.insertFile({
    kind: "batch_update",
    originalFilename: `${vendorSlug}-inventory-update-import-${dateSuffix}.csv`,
    storagePath: updateFile.storagePath,
    checksumSha256: updateFile.checksum,
    sizeBytes: updateFile.sizeBytes,
    rowCount: updateRows.length,
    uploadedBy: userId,
  });
  const rollbackFileRecord = await repo.insertFile({
    kind: "batch_rollback",
    originalFilename: `${vendorSlug}-inventory-rollback-${dateSuffix}.csv`,
    storagePath: rollbackFile.storagePath,
    checksumSha256: rollbackFile.checksum,
    sizeBytes: rollbackFile.sizeBytes,
    rowCount: rollbackRows.length,
    uploadedBy: userId,
  });
  const exceptionFileRecord = await repo.insertFile({
    kind: "batch_exception",
    originalFilename: `${vendorSlug}-inventory-exceptions-${dateSuffix}.csv`,
    storagePath: exceptionFile.storagePath,
    checksumSha256: exceptionFile.checksum,
    sizeBytes: exceptionFile.sizeBytes,
    rowCount: exceptionRows.length,
    uploadedBy: userId,
  });
  const reconciliationFileRecord = await repo.insertFile({
    kind: "batch_reconciliation",
    originalFilename: `${vendorSlug}-inventory-reconciliation-${dateSuffix}.csv`,
    storagePath: reconciliationFile.storagePath,
    checksumSha256: reconciliationFile.checksum,
    sizeBytes: reconciliationFile.sizeBytes,
    rowCount: fullReconciliationRows.length,
    uploadedBy: userId,
  });

  const batch = await repo.insertBatch({
    runId,
    updateFileId: updateFileRecord.id,
    rollbackFileId: rollbackFileRecord.id,
    exceptionFileId: exceptionFileRecord.id,
    reconciliationFileId: reconciliationFileRecord.id,
    createdBy: userId,
  });

  await repo.lockDecisionsForBatch(
    batchable.map((v) => v.row.id),
    batch.id,
  );

  await repo.insertAuditLog({
    actorId: userId,
    action: "BATCH_GENERATED",
    entityType: "batch",
    entityId: batch.id,
    details: { runId, rowCount: batchable.length },
  });

  return batch;
}
