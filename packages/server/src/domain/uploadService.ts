import { saveUploadedFile, computeChecksum } from "../storage/fileStorage";
import { getRepository, type FileKind, type FileRecord } from "../db";
import { getVendorFileAdapter, detectVendorFile } from "../vendor/vendorFileRegistry";
import { parseMivaSnapshotCsv } from "../vendor/mivaCsv";
import { parseLegacyAuditCsv } from "../vendor/legacyAuditCsv";
import { ValidationError } from "../errors";

export interface UploadResult {
  file: FileRecord;
  duplicateOf: FileRecord | null;
}

async function validateAndCountRows(buffer: Buffer, kind: FileKind): Promise<number> {
  const vendorAdapter = getVendorFileAdapter(kind);
  if (vendorAdapter) {
    const { rows } = await vendorAdapter.parse(buffer);
    return rows.length;
  }
  if (kind === "miva_snapshot" || kind === "post_import_snapshot") {
    const { rows } = parseMivaSnapshotCsv(buffer.toString("utf8"));
    return rows.length;
  }
  if (kind === "legacy_audit") {
    const rows = parseLegacyAuditCsv(buffer.toString("utf8"));
    return rows.length;
  }
  throw new ValidationError("UNSUPPORTED_KIND", `File kind ${kind} cannot be uploaded directly.`);
}

/**
 * Always derived from the actual uploaded filename, never assumed from
 * `kind` -- vendor file format is a property of each vendor's export, not of
 * this app's internal FileKind label. Olliix happens to be .xlsx-only today,
 * but a future vendor onboarded as CSV (see vendor/ adapter isolation
 * pattern) must not have its extension silently coerced to something else.
 */
function extensionFor(originalFilename: string): string {
  const dot = originalFilename.lastIndexOf(".");
  return dot >= 0 ? originalFilename.slice(dot) : ".csv";
}

/** Shared checksum/dedupe/store/insert/audit-log logic once a FileKind and row count are already known. */
async function finishUpload(
  buffer: Buffer,
  originalFilename: string,
  kind: FileKind,
  rowCount: number,
  userId: string,
  confirmDuplicate: boolean,
  vendorKey: string | null = null,
): Promise<UploadResult> {
  const repo = getRepository();

  const checksum = computeChecksum(buffer);
  const existing = await repo.findFileByChecksum(kind, checksum);
  if (existing && !confirmDuplicate) {
    return { file: existing, duplicateOf: existing };
  }

  const saved = saveUploadedFile(buffer, kind, extensionFor(originalFilename));
  const file = await repo.insertFile({
    kind,
    originalFilename,
    storagePath: saved.storagePath,
    checksumSha256: saved.checksum,
    sizeBytes: saved.sizeBytes,
    rowCount,
    uploadedBy: userId,
    vendorKey,
  });

  await repo.insertAuditLog({
    actorId: userId,
    action: "FILE_UPLOADED",
    entityType: "file",
    entityId: file.id,
    details: { kind, rowCount, checksum },
  });

  return { file, duplicateOf: existing ?? null };
}

export async function uploadFile(
  buffer: Buffer,
  originalFilename: string,
  kind: FileKind,
  userId: string,
  confirmDuplicate: boolean,
): Promise<UploadResult> {
  // Validate before persisting: block processing per
  // CozyWinters_Vendor_Inventory_Automation_Plan.md section 4.
  const rowCount = await validateAndCountRows(buffer, kind);
  return finishUpload(buffer, originalFilename, kind, rowCount, userId, confirmDuplicate);
}

/**
 * Uploads a vendor inventory file without the caller specifying which
 * vendor it is -- the vendor is detected purely from the file's own content
 * (sheet name / required columns), never the filename. Used by the single
 * "Vendor Inventory Data" upload area, which no longer has per-vendor tabs.
 */
export async function uploadVendorFileAutoDetect(
  buffer: Buffer,
  originalFilename: string,
  userId: string,
  confirmDuplicate: boolean,
): Promise<UploadResult & { detectedVendorLabel: string }> {
  const { vendorKey, fileKind, rows } = await detectVendorFile(buffer);
  const isDynamic = fileKind === "vendor_dynamic";
  const result = await finishUpload(
    buffer,
    originalFilename,
    fileKind,
    rows.length,
    userId,
    confirmDuplicate,
    isDynamic ? vendorKey : null,
  );
  const config = await getRepository().findVendorConfigByKey(vendorKey);
  return { ...result, detectedVendorLabel: config?.vendorLabel ?? vendorKey };
}
