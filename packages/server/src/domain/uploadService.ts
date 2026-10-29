import { saveUploadedFile, computeChecksum, storedFileExists } from "../storage/fileStorage";
import { getRepository, type FileKind, type FileRecord } from "../db";
import { getVendorFileAdapter, detectVendorFile } from "../vendor/vendorFileRegistry";
import { parseMivaSnapshotCsv } from "../vendor/mivaCsv";
import { parseLegacyAuditCsv } from "../vendor/legacyAuditCsv";
import { parseDiscontinuedListWorkbook, type ParsedDiscontinuedList } from "../vendor/discontinuedListParser";
import { importDiscontinuedList, DISCONTINUED_LIST_VENDOR_KEY, type DiscontinuedImportResult } from "./discontinuedListService";
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
  if (kind === "miva_snapshot" || kind === "post_import_snapshot" || kind === "dev_reset_reference") {
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
  sourceSite: "development" | "live" | null = null,
): Promise<UploadResult> {
  const repo = getRepository();

  const checksum = computeChecksum(buffer);
  const foundExisting = await repo.findFileByChecksum(kind, checksum);
  // A DB row surviving a container restart doesn't mean its bytes did too,
  // on a host with no persistent volume -- only treat it as a real
  // duplicate if the file is actually still readable. Otherwise fall
  // through and re-save fresh bytes under a new record, same as if no
  // duplicate had ever existed.
  const existing = foundExisting && storedFileExists(foundExisting.storagePath) ? foundExisting : null;
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
    sourceSite,
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
  sourceSite: "development" | "live" | null = null,
): Promise<UploadResult> {
  // Validate before persisting: block processing per
  // CozyWinters_Vendor_Inventory_Automation_Plan.md section 4.
  const rowCount = await validateAndCountRows(buffer, kind);
  return finishUpload(buffer, originalFilename, kind, rowCount, userId, confirmDuplicate, null, sourceSite);
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
): Promise<UploadResult & { detectedVendorLabel: string; discontinuedImport?: DiscontinuedImportResult }> {
  // The emailed "Discontinued Items Notification" is checked first: it is recognized by its own worksheet name and
  // headers, so it can't be mistaken for a vendor inventory file, and (unlike one) it is merged into the cumulative
  // discontinued list instead of becoming a run input.
  const discontinuedList = await tryParseDiscontinuedList(buffer);
  if (discontinuedList) {
    const result = await finishUpload(buffer, originalFilename, "discontinued_list", discontinuedList.items.length, userId, confirmDuplicate);
    // An unconfirmed duplicate was not stored, and its items are already in the list, so there is nothing to import.
    const discontinuedImport =
      result.duplicateOf && !confirmDuplicate ? undefined : await importDiscontinuedList(discontinuedList, result.file, userId);
    const config = await getRepository().findVendorConfigByKey(DISCONTINUED_LIST_VENDOR_KEY);
    return { ...result, detectedVendorLabel: config?.vendorLabel ?? DISCONTINUED_LIST_VENDOR_KEY, discontinuedImport };
  }

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

/** Null for anything that isn't the discontinued-items workbook (any other xlsx, a CSV, a corrupt file) -- the caller then falls through to normal vendor detection. */
async function tryParseDiscontinuedList(buffer: Buffer): Promise<ParsedDiscontinuedList | null> {
  try {
    return await parseDiscontinuedListWorkbook(buffer);
  } catch (err) {
    // Right sheet but unusable content (missing columns / zero rows) deserves its own message, not "vendor not detected".
    if (err instanceof ValidationError && (err.code === "REQUIRED_COLUMNS_MISSING" || err.code === "ZERO_DATA_ROWS")) throw err;
    return null;
  }
}
