import type { ReconciliationRow } from "@cozywinters/shared";

// Shared record and filter shapes for both the SQLite (default, native
// Windows) and PostgreSQL (optional, Docker) repository implementations.
// Domain services depend only on these types and the Repository interface
// in Repository.ts -- never on a concrete database driver.

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
}

export type FileKind =
  | "olliix_workbook"
  | "kh_workbook"
  | "gobi_workbook"
  | "fieldsheer_workbook"
  | "miva_snapshot"
  | "legacy_audit"
  | "post_import_snapshot"
  | "batch_update"
  | "batch_rollback"
  | "batch_exception"
  | "batch_reconciliation";

export interface FileRecord {
  id: string;
  kind: FileKind;
  originalFilename: string;
  storagePath: string;
  checksumSha256: string;
  sizeBytes: number;
  rowCount: number | null;
  uploadedAt: string;
}

export interface InsertFileInput {
  kind: FileKind;
  originalFilename: string;
  storagePath: string;
  checksumSha256: string;
  sizeBytes: number;
  rowCount?: number;
  uploadedBy: string;
}

export type RunStatus = "validating" | "normalizing" | "matching" | "calculating" | "ready" | "failed";

export interface RunRecord {
  id: string;
  vendorFileId: string;
  mivaFileId: string;
  ruleId: string;
  ruleConfigHash: string;
  runDate: string;
  status: RunStatus;
  failureReason: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface InsertRunInput {
  vendorFileId: string;
  mivaFileId: string;
  ruleId: string;
  ruleConfigHash: string;
  runDate: string;
  status: RunStatus;
  createdBy: string;
}

export interface ReconciliationRowRecord extends ReconciliationRow {
  id: string;
  runId: string;
}

export interface DecisionRecord {
  id: string;
  reconciliationRowId: string;
  runId: string;
  status: "PENDING" | "APPROVED" | "APPROVED_WARNING_ACK" | "REJECTED";
  warningsAtDecision: string[];
  decidedAt: string | null;
  batchId: string | null;
  locked: boolean;
}

export interface ReviewRowView {
  row: ReconciliationRowRecord;
  decision: DecisionRecord;
}

export interface RowFilter {
  reviewClass?: string[];
  changed?: boolean;
  decisionStatus?: string[];
  matchOutcome?: string[];
  search?: string;
}

export interface BatchRecord {
  id: string;
  runId: string;
  updateFileId: string | null;
  rollbackFileId: string | null;
  exceptionFileId: string | null;
  reconciliationFileId: string | null;
  importStatus: string;
  createdAt: string;
}

export interface InsertBatchInput {
  runId: string;
  updateFileId: string;
  rollbackFileId: string;
  exceptionFileId: string;
  reconciliationFileId: string;
  createdBy: string;
}

export interface LegacyComparisonRowInput {
  sourceRowNumber: number | null;
  productCode: string | null;
  comparisonClass: string;
  deviationId: string | null;
  note: string;
}

export interface LegacyComparisonRowRecord extends LegacyComparisonRowInput {
  id: string;
  legacyComparisonId: string;
}

export interface PostImportVerificationRowInput {
  productCode: string;
  result: string;
  reason: string;
}

export interface PostImportVerificationRowRecord extends PostImportVerificationRowInput {
  id: string;
  verificationId: string;
}

export interface AuditLogInput {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details?: Record<string, unknown>;
}
