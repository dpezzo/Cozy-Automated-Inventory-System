import type { ReconciliationRow, BlockerCode } from "@cozywinters/shared";
import type { GenericCsvColumnMapping } from "../vendor/genericCsvParser";

// Shared record and filter shapes for both the SQLite (default, native
// Windows) and PostgreSQL (optional, Docker) repository implementations.
// Domain services depend only on these types and the Repository interface
// in Repository.ts -- never on a concrete database driver.

export type UserRole = "admin" | "member";

export interface UserRecord {
  id: string;
  email: string;
  /** Never a real value the client sees; null means "no password set" (Google-only account). */
  passwordHash: string | null;
  role: UserRole;
  googleId: string | null;
  displayName: string | null;
  isActive: boolean;
}

export interface CreateUserInput {
  email: string;
  passwordHash?: string | null;
  googleId?: string | null;
  role: UserRole;
  displayName?: string | null;
}

export interface UpdateUserPatch {
  role?: UserRole;
  isActive?: boolean;
  displayName?: string | null;
  googleId?: string | null;
  passwordHash?: string | null;
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
  | "batch_reconciliation"
  /** A dynamically-configured vendor's file (file_shape 'simple_csv' or 'plugin'). Which vendor is recorded in FileRecord.vendorKey, not in this kind. */
  | "vendor_dynamic";

export interface FileRecord {
  id: string;
  kind: FileKind;
  originalFilename: string;
  storagePath: string;
  checksumSha256: string;
  sizeBytes: number;
  rowCount: number | null;
  uploadedAt: string;
  /** Set only for kind === "vendor_dynamic"; null for every built-in FileKind. */
  vendorKey: string | null;
}

export interface InsertFileInput {
  kind: FileKind;
  originalFilename: string;
  storagePath: string;
  checksumSha256: string;
  sizeBytes: number;
  rowCount?: number;
  uploadedBy: string;
  vendorKey?: string | null;
}

// ---------- Vendor configs ----------

export type VendorFileShape = "custom" | "simple_csv" | "plugin";
export type VendorMatchStrategy = "upc-to-gtin" | "sku-to-mpn";

export interface VendorConfigRecord {
  vendorKey: string;
  vendorLabel: string;
  inStockThreshold: number;
  timezone: string;
  brandAllowlist: string[];
  matchStrategy: VendorMatchStrategy;
  missingBlockerCode: BlockerCode | null;
  fileShape: VendorFileShape;
  columnMapping: GenericCsvColumnMapping | null;
  pluginFilename: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InsertVendorConfigInput {
  vendorKey: string;
  vendorLabel: string;
  inStockThreshold: number;
  timezone: string;
  brandAllowlist: string[];
  matchStrategy: VendorMatchStrategy;
  missingBlockerCode?: BlockerCode | null;
  fileShape: VendorFileShape;
  columnMapping?: GenericCsvColumnMapping | null;
  pluginFilename?: string | null;
}

export interface UpdateVendorConfigPatch {
  vendorLabel?: string;
  inStockThreshold?: number;
  timezone?: string;
  brandAllowlist?: string[];
  matchStrategy?: VendorMatchStrategy;
  columnMapping?: GenericCsvColumnMapping | null;
  isActive?: boolean;
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
