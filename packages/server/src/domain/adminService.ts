import { getRepository, type ClearDataCounts, type ClearDataResult, type ClearDataScope } from "../db";
import { deleteStoredFile } from "../storage/fileStorage";

/** Dry-run: same deletion logic as clearData, rolled back -- the counts are guaranteed to match what clearData would actually do. */
export async function previewClearData(scope: ClearDataScope): Promise<ClearDataCounts> {
  return getRepository().previewClearData(scope);
}

/**
 * Wipes whichever of ClearDataScope's categories are selected (run history,
 * Miva catalog snapshots, and/or the activity log), plus the files that
 * become orphaned as a result, then unlinks those files from disk once the
 * DB commit has succeeded. Users and vendor configs are never touched by any
 * scope. This action is always re-logged as a fresh audit entry afterward --
 * even when the activityLog scope just wiped the table it's about to be
 * written back into, so a clear always leaves at least one record of itself.
 */
export async function clearData(scope: ClearDataScope, actorId: string): Promise<ClearDataResult> {
  const repo = getRepository();
  const result = await repo.clearData(scope);

  for (const storagePath of result.deletedFileStoragePaths) {
    deleteStoredFile(storagePath);
  }

  await repo.insertAuditLog({
    actorId,
    action: "DATA_CLEARED",
    entityType: "system",
    entityId: null,
    details: {
      scope,
      runs: result.runs,
      batches: result.batches,
      reconciliationRows: result.reconciliationRows,
      decisions: result.decisions,
      legacyComparisons: result.legacyComparisons,
      postImportVerifications: result.postImportVerifications,
      files: result.files,
      totalFileBytes: result.totalFileBytes,
      activityLogEntries: result.activityLogEntries,
    },
  });

  return result;
}
