import { verifyPostImport } from "@cozywinters/shared";
import { getRepository } from "../db";
import { readStoredFileText } from "../storage/fileStorage";
import { parseMivaSnapshotCsv, mivaRowsByProductCode } from "../vendor/mivaCsv";
import { readBatchCsv } from "./batchCsvIO";
import { ValidationError } from "../errors";

export async function runPostImportVerification(
  batchId: string,
  postImportFileId: string,
  userId: string,
): Promise<string> {
  const repo = getRepository();
  const batch = await repo.findBatchById(batchId);
  if (!batch) throw new ValidationError("BATCH_NOT_FOUND", "Batch not found.");
  if (!batch.updateFileId) throw new ValidationError("BATCH_INCOMPLETE", "Batch is missing its update file.");

  const postImportFile = await repo.findFileById(postImportFileId);
  if (!postImportFile || postImportFile.kind !== "post_import_snapshot") {
    throw new ValidationError("FILE_NOT_FOUND", "The selected post-import Miva snapshot was not found.");
  }

  const run = await repo.findRunById(batch.runId);
  if (!run) throw new ValidationError("RUN_NOT_FOUND", "Run not found.");
  const preImportFile = await repo.findFileById(run.mivaFileId);
  if (!preImportFile) throw new ValidationError("FILE_NOT_FOUND", "Pre-import Miva snapshot not found.");

  const updateFile = await repo.findFileById(batch.updateFileId);
  if (!updateFile) throw new ValidationError("FILE_NOT_FOUND", "Batch update file not found.");

  const updateBatchRows = readBatchCsv(readStoredFileText(updateFile.storagePath));
  const { rows: preRows } = parseMivaSnapshotCsv(readStoredFileText(preImportFile.storagePath));
  const { rows: postRows } = parseMivaSnapshotCsv(readStoredFileText(postImportFile.storagePath));

  const results = verifyPostImport({
    approvedBatchRows: updateBatchRows,
    preImportByProductCode: mivaRowsByProductCode(preRows),
    postImportByProductCode: mivaRowsByProductCode(postRows),
  });

  const verificationId = await repo.insertPostImportVerification(batchId, postImportFileId, userId, results);

  await repo.insertAuditLog({
    actorId: userId,
    action: "POST_IMPORT_VERIFICATION_RUN",
    entityType: "batch",
    entityId: batchId,
    details: { fail: results.filter((r) => r.result === "FAIL").length, pass: results.filter((r) => r.result === "PASS").length },
  });

  return verificationId;
}
