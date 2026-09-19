import { saveUploadedFile, computeChecksum } from "../storage/fileStorage";
import { getRepository, type FileKind, type FileRecord } from "../db";
import { parseOlliixWorkbook } from "../vendor/olliixParser";
import { parseMivaSnapshotCsv } from "../vendor/mivaCsv";
import { parseLegacyAuditCsv } from "../vendor/legacyAuditCsv";
import { ValidationError } from "../errors";

export interface UploadResult {
  file: FileRecord;
  duplicateOf: FileRecord | null;
}

async function validateAndCountRows(buffer: Buffer, kind: FileKind): Promise<number> {
  if (kind === "olliix_workbook") {
    const { rows } = await parseOlliixWorkbook(buffer);
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

function extensionFor(kind: FileKind, originalFilename: string): string {
  if (kind === "olliix_workbook") return ".xlsx";
  const dot = originalFilename.lastIndexOf(".");
  return dot >= 0 ? originalFilename.slice(dot) : ".csv";
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
  const repo = getRepository();

  const checksum = computeChecksum(buffer);
  const existing = await repo.findFileByChecksum(kind, checksum);
  if (existing && !confirmDuplicate) {
    return { file: existing, duplicateOf: existing };
  }

  const saved = saveUploadedFile(buffer, kind, extensionFor(kind, originalFilename));
  const file = await repo.insertFile({
    kind,
    originalFilename,
    storagePath: saved.storagePath,
    checksumSha256: saved.checksum,
    sizeBytes: saved.sizeBytes,
    rowCount,
    uploadedBy: userId,
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
