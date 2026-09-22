import {
  toVendorExceptionRows,
  VENDOR_EXCEPTION_HEADERS,
  type VendorExceptionCategory,
} from "@cozywinters/shared";
import { getRepository, type FileRecord } from "../db";
import { ValidationError } from "../errors";
import { saveGeneratedFile } from "../storage/fileStorage";
import { rowsToCsv } from "../csv/writeCsv";
import { rowsToXlsx } from "../csv/writeXlsx";
import { formatRunDateMMDDYY, vendorSlugFromRuleId } from "./batchService";

export type VendorExceptionReportFormat = "csv" | "xlsx";

/**
 * Generates an on-demand, vendor-facing exception report for a run -- unlike
 * the internal exception file batchService.ts produces (which mixes every
 * blocker/warning reason and only exists after a batch is generated), this
 * is filterable to just the categories worth sending back to the vendor,
 * available any time from Run Review, and exportable as either CSV or Excel
 * depending on what's easiest for that vendor to work with.
 */
export async function generateVendorExceptionReport(
  runId: string,
  userId: string,
  categories: VendorExceptionCategory[],
  format: VendorExceptionReportFormat = "csv",
): Promise<FileRecord> {
  const repo = getRepository();
  const run = await repo.findRunById(runId);
  if (!run) throw new ValidationError("RUN_NOT_FOUND", "Run not found.");

  const allRows = await repo.listRunRows(runId);
  const vendorRows = toVendorExceptionRows(allRows.map((v) => v.row), categories).map((r) => ({
    ITEM_NO: r.itemNo ?? "",
    VENDOR_UPC: r.vendorUpc ?? "",
    MIVA_PRODUCT_CODE: r.productCode ?? "",
    DESCRIPTION: r.description ?? "",
    STATUS: r.mivaStatus ?? "",
    TOTAL_QTY: r.totalQtyRaw ?? "",
    REASON: r.reasonCodes,
    DETAIL: r.detail,
  }));

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const extension = format === "xlsx" ? "xlsx" : "csv";
  const content =
    format === "xlsx"
      ? await rowsToXlsx(vendorRows, [...VENDOR_EXCEPTION_HEADERS], { sanitizeFormulas: true, sheetName: "Exceptions" })
      : rowsToCsv(vendorRows, [...VENDOR_EXCEPTION_HEADERS], { sanitizeFormulas: true });
  const savedFile = saveGeneratedFile(
    content,
    "vendor_exception_report",
    `${runId}_vendor-exceptions_${timestamp}.${extension}`,
  );

  const dateSuffix = formatRunDateMMDDYY(run.runDate);
  const vendorSlug = vendorSlugFromRuleId(run.ruleId);
  const fileRecord = await repo.insertFile({
    kind: "vendor_exception_report",
    originalFilename: `${vendorSlug}-vendor-exceptions-${dateSuffix}.${extension}`,
    storagePath: savedFile.storagePath,
    checksumSha256: savedFile.checksum,
    sizeBytes: savedFile.sizeBytes,
    rowCount: vendorRows.length,
    uploadedBy: userId,
  });

  await repo.insertAuditLog({
    actorId: userId,
    action: "VENDOR_EXCEPTION_REPORT_GENERATED",
    entityType: "run",
    entityId: runId,
    details: { categories, format, rowCount: vendorRows.length },
  });

  return fileRecord;
}
