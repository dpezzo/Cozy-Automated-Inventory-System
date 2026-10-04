import type { BatchCsvRow } from "@cozywinters/shared";
import { getRepository } from "../db";
import { readStoredFileText, saveUploadedFile, computeChecksum } from "../storage/fileStorage";
import { parseMivaSnapshotCsv } from "../vendor/mivaCsv";
import { ValidationError } from "../errors";
import { chunk, pushChunk, verifyPushedRows, resolveMivaPushEnvironment, type PushRowResult } from "./mivaApiPush";

const CHUNK_SIZE = 100;

export interface DevResetResult {
  pushed: number;
  failed: number;
  verificationMismatches: number;
  results: PushRowResult[];
}

/** Uploads a new dev-site reset reference CSV and makes it the active one for resetDevSiteProducts(). The previous reference file's row in `files` is left untouched (never deleted), matching this app's existing never-delete-on-replace pattern. */
export async function uploadDevResetReferenceFile(
  buffer: Buffer,
  originalFilename: string,
  userId: string,
): Promise<{ fileId: string; rowCount: number }> {
  const { rows } = parseMivaSnapshotCsv(buffer.toString("utf8"));
  const saved = saveUploadedFile(buffer, "dev_reset_reference", ".csv");
  const repo = getRepository();
  const file = await repo.insertFile({
    kind: "dev_reset_reference",
    originalFilename,
    storagePath: saved.storagePath,
    checksumSha256: computeChecksum(buffer),
    sizeBytes: saved.sizeBytes,
    rowCount: rows.length,
    uploadedBy: userId,
    vendorKey: null,
  });
  await repo.setDevResetReferenceFileId(file.id);
  await repo.insertAuditLog({
    actorId: userId,
    action: "DEV_RESET_REFERENCE_UPLOADED",
    entityType: "file",
    entityId: file.id,
    details: { rowCount: rows.length },
  });
  return { fileId: file.id, rowCount: rows.length };
}

/**
 * Pushes the currently-active dev-reset reference CSV to Miva wholesale, via
 * the exact same Product_Update chunking/verification mivaApiPush.ts uses for
 * a real batch push. Deliberately does not touch runs/batches/decisions --
 * this is "restore to a known-good baseline," not a reconciliation, so
 * reusing those tables would misrepresent what happened.
 *
 * Hard-gated to the development site, unconditionally: unlike pushBatchToMiva,
 * there is no confirmProduction override here at all. A reset must never be
 * capable of reaching the live site, regardless of what Settings > Miva
 * Connection is set to.
 */
export async function resetDevSiteProducts(userId: string): Promise<DevResetResult> {
  const environment = await resolveMivaPushEnvironment();
  if (environment !== "development") {
    throw new ValidationError(
      "DEV_RESET_REQUIRES_DEVELOPMENT_SITE",
      "The dev site reset can only run while Settings > Miva Connection is set to Development.",
    );
  }

  const repo = getRepository();
  const fileId = await repo.getDevResetReferenceFileId();
  if (!fileId) {
    throw new ValidationError("NO_RESET_REFERENCE_FILE", "No dev-site reset reference file has been uploaded yet.");
  }
  const file = await repo.findFileById(fileId);
  if (!file) throw new ValidationError("FILE_NOT_FOUND", "The dev-site reset reference file was not found.");

  const { rows: mivaRows } = parseMivaSnapshotCsv(readStoredFileText(file.storagePath));
  if (mivaRows.length === 0) {
    throw new ValidationError("NO_ROWS", "The dev-site reset reference file has no rows to push.");
  }

  const rows: BatchCsvRow[] = mivaRows.map((r) => ({
    PRODUCT_CODE: r.productCode,
    "*CUSTOM_SIMPLE_INVENTORY": r.currentSimpleInventory,
    "*DF-AVAILABILITY": r.currentAvailability,
    "*ORD-INV_RESTOCK_DATE_DF-MERG-IN:": r.currentRestockMessage,
    "*DF-DATAFEED": r.currentDataFeed,
    "*DF-SHOPPING_FEED": r.currentShoppingFeed,
    DROPSHIP_INVENTORY_MANAGEMENT: r.currentDsInvMgt,
  }));

  const results: PushRowResult[] = [];
  let chunkError: unknown;
  try {
    for (const group of chunk(rows, CHUNK_SIZE)) {
      results.push(...(await pushChunk(group)));
    }
  } catch (err) {
    chunkError = err;
  }

  const succeededRows = rows.filter((_, i) => results[i]?.success);
  const verificationMismatches = succeededRows.length > 0 ? await verifyPushedRows(succeededRows) : 0;

  const pushed = results.filter((r) => r.success).length;
  const failed = results.length - pushed + (chunkError ? rows.length - results.length : 0);

  await repo.insertAuditLog({
    actorId: userId,
    action: chunkError ? "DEV_RESET_PARTIAL_FAILURE" : failed === 0 ? "DEV_RESET_PUSHED" : "DEV_RESET_FAILED",
    entityType: "file",
    entityId: file.id,
    details: {
      pushed,
      failed,
      verificationMismatches,
      totalRows: rows.length,
      unattempted: chunkError ? rows.length - results.length : 0,
      chunkError: chunkError instanceof Error ? chunkError.message : chunkError ? String(chunkError) : undefined,
    },
  });

  if (chunkError) throw chunkError;

  return { pushed, failed, verificationMismatches, results };
}
