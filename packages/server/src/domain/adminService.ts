import { getRepository, type ClearDataCounts, type ClearDataResult } from "../db";
import { deleteStoredFile } from "../storage/fileStorage";

/** Dry-run: same deletion logic as clearData, rolled back -- the counts are guaranteed to match what clearData would actually do. */
export async function previewClearData(beforeDate: string | null): Promise<ClearDataCounts> {
  return getRepository().previewClearData(beforeDate);
}

/**
 * Wipes runs (and everything hanging off them) plus the files that become
 * orphaned as a result, then unlinks those files from disk once the DB
 * commit has succeeded. Users, vendor configs, and the audit log are never
 * touched -- this entry itself is the permanent record of who cleared what.
 */
export async function clearData(beforeDate: string | null, actorId: string): Promise<ClearDataResult> {
  const repo = getRepository();
  const result = await repo.clearData(beforeDate);

  for (const storagePath of result.deletedFileStoragePaths) {
    deleteStoredFile(storagePath);
  }

  await repo.insertAuditLog({
    actorId,
    action: "DATA_CLEARED",
    entityType: "system",
    entityId: null,
    details: {
      beforeDate,
      runs: result.runs,
      batches: result.batches,
      reconciliationRows: result.reconciliationRows,
      decisions: result.decisions,
      legacyComparisons: result.legacyComparisons,
      postImportVerifications: result.postImportVerifications,
      files: result.files,
      totalFileBytes: result.totalFileBytes,
    },
  });

  return result;
}
