import { compareWithLegacy } from "@cozywinters/shared";
import { getRepository } from "../db";
import { readStoredFileText } from "../storage/fileStorage";
import { parseLegacyAuditCsv } from "../vendor/legacyAuditCsv";
import { ValidationError } from "../errors";

export async function runLegacyComparison(runId: string, legacyFileId: string, userId: string): Promise<string> {
  const repo = getRepository();
  const legacyFile = await repo.findFileById(legacyFileId);
  if (!legacyFile || legacyFile.kind !== "legacy_audit") {
    throw new ValidationError("FILE_NOT_FOUND", "The selected legacy audit CSV was not found.");
  }
  const run = await repo.findRunById(runId);
  if (!run) throw new ValidationError("RUN_NOT_FOUND", "Run not found.");

  const legacyRows = parseLegacyAuditCsv(readStoredFileText(legacyFile.storagePath));
  const reviewRows = await repo.listRunRows(runId);
  const comparison = compareWithLegacy(
    reviewRows.map((v) => v.row),
    legacyRows,
  );

  const comparisonId = await repo.insertLegacyComparison(
    runId,
    legacyFileId,
    userId,
    comparison.map((c) => ({
      sourceRowNumber: c.sourceRowNumber,
      productCode: c.productCode,
      comparisonClass: c.comparisonClass,
      deviationId: c.deviationId,
      note: c.note,
    })),
  );

  await repo.insertAuditLog({
    actorId: userId,
    action: "LEGACY_COMPARISON_RUN",
    entityType: "run",
    entityId: runId,
    details: {
      unexplained: comparison.filter((c) => c.comparisonClass === "UNEXPLAINED_DIFFERENCE").length,
      exact: comparison.filter((c) => c.comparisonClass === "EXACT_MATCH").length,
    },
  });

  return comparisonId;
}
