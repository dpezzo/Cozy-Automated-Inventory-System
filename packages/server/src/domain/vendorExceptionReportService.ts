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
import { parseMivaSnapshotCsv } from "../vendor/mivaCsv";
import { readStoredFileText, storedFileExists } from "../storage/fileStorage";
import { listUntrackedBrandRows } from "./runService";
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
  includeAll = false,
): Promise<FileRecord> {
  const repo = getRepository();
  const run = await repo.findRunById(runId);
  if (!run) throw new ValidationError("RUN_NOT_FOUND", "Run not found.");

  const allRows = await repo.listRunRows(runId);
  // "Export everything": every vendor-file row plus every Miva product for the brand that the file never
  // mentions (the same synthetic "Not tracked" rows as Run Review's "Show all Miva products"), with Miva's
  // Active flag looked up from the run's Miva snapshot so the report can be used as a full comparison.
  const sourceRows = includeAll ? [...allRows, ...(await listUntrackedBrandRows(runId))] : allRows;
  const mivaActiveByCode = new Map<string, string>();
  if (includeAll) {
    const mivaFile = await repo.findFileById(run.mivaFileId);
    if (mivaFile && storedFileExists(mivaFile.storagePath)) {
      for (const m of parseMivaSnapshotCsv(readStoredFileText(mivaFile.storagePath)).rows) {
        mivaActiveByCode.set(m.productCode, m.active === undefined ? "" : m.active === "1" ? "Yes" : m.active === "0" ? "No" : m.active);
      }
    }
  }
  const activeFor = (code: string | null): string =>
    code ? code.split("|").map((c) => mivaActiveByCode.get(c) ?? "").join("|") : "";
  const vendorRows = toVendorExceptionRows(
    sourceRows.map((v) => ({ ...v.row, decisionStatus: v.decision.status })),
    categories,
    { all: includeAll },
  ).map((r) => ({
    ...(includeAll
      ? {
          // IN_FILE: the row came from the vendor file (Miva-only / not-tracked rows did not).
          // IN_MIVA: the row resolved to a Miva product (unmatched file rows did not).
          IN_FILE: r.outcome === "Miva only" || r.outcome === "Not tracked" ? "No" : "Yes",
          IN_MIVA: r.productCode ? "Yes" : "No",
          MIVA_ACTIVE: activeFor(r.productCode),
        }
      : {}),
    MIVA_PRODUCT_CODE: r.productCode ?? "",
    ITEM_NO: r.itemNo ?? "",
    VENDOR_UPC: r.vendorUpc ?? "",
    OUTCOME: r.outcome,
    CLASS: r.reviewClass,
    WARNINGS_BLOCKERS: r.reasonCodes,
    TOTAL_QTY: r.totalQtyRaw ?? "",
    CURRENT_STATUS: r.mivaStatus ?? "",
    PROPOSED_STATUS: r.proposedStatus ?? "",
    PROPOSED_RESTOCK: r.proposedRestock ?? "",
    PRODUCT_PHASE: r.productPhase ?? "",
    CHANGED_FIELDS: r.changedFields,
    DECISION: r.decision,
    DESCRIPTION: r.description ?? "",
    DETAIL: r.detail,
  }));

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const extension = format === "xlsx" ? "xlsx" : "csv";
  const headers = includeAll ? ["IN_FILE", "IN_MIVA", "MIVA_ACTIVE", ...VENDOR_EXCEPTION_HEADERS] : [...VENDOR_EXCEPTION_HEADERS];
  const content =
    format === "xlsx"
      ? await rowsToXlsx(vendorRows, headers, { sanitizeFormulas: true, sheetName: includeAll ? "All records" : "Exceptions", numericColumns: ["TOTAL_QTY"] })
      : rowsToCsv(vendorRows, headers, { sanitizeFormulas: true });
  const savedFile = saveGeneratedFile(
    content,
    "vendor_exception_report",
    `${runId}_vendor-exceptions_${timestamp}.${extension}`,
  );

  const dateSuffix = formatRunDateMMDDYY(run.runDate);
  const vendorSlug = vendorSlugFromRuleId(run.ruleId);
  const fileRecord = await repo.insertFile({
    kind: "vendor_exception_report",
    originalFilename: `${vendorSlug}-${includeAll ? "all-records" : "vendor-exceptions"}-${dateSuffix}.${extension}`,
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
    details: { categories, format, includeAll, rowCount: vendorRows.length },
  });

  return fileRecord;
}
