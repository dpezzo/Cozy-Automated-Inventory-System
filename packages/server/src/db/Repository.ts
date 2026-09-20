import type { ReconciliationRow } from "@cozywinters/shared";
import type {
  UserRecord,
  CreateUserInput,
  UpdateUserPatch,
  FileKind,
  FileRecord,
  InsertFileInput,
  RunRecord,
  RunStatus,
  InsertRunInput,
  ReviewRowView,
  RowFilter,
  BatchRecord,
  InsertBatchInput,
  LegacyComparisonRowInput,
  PostImportVerificationRowInput,
  AuditLogInput,
  VendorConfigRecord,
  InsertVendorConfigInput,
  UpdateVendorConfigPatch,
} from "./types";

/**
 * The full persistence contract the application depends on. Reconciliation,
 * approval, batch-generation, and validation rules (packages/shared and
 * packages/server/src/domain) call only through this interface, so the
 * concrete backend -- SQLite by default, PostgreSQL optionally -- can be
 * swapped without touching any business logic.
 */
export interface Repository {
  // Lifecycle
  init(): Promise<void>;
  close(): Promise<void>;

  // Users
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByGoogleId(googleId: string): Promise<UserRecord | null>;
  upsertUser(email: string, passwordHash: string): Promise<UserRecord>;
  listUsers(): Promise<UserRecord[]>;
  createUser(input: CreateUserInput): Promise<UserRecord>;
  updateUser(id: string, patch: UpdateUserPatch): Promise<UserRecord>;
  /** Soft delete: sets is_active = false. Never actually deletes the row -- attribution FKs elsewhere must keep resolving. */
  deleteUser(id: string): Promise<void>;

  // Files
  insertFile(input: InsertFileInput): Promise<FileRecord>;
  findFileByChecksum(kind: FileKind, checksum: string): Promise<FileRecord | null>;
  findFileById(id: string): Promise<FileRecord | null>;
  listFiles(kind?: FileKind): Promise<FileRecord[]>;

  // Runs
  insertRun(input: InsertRunInput): Promise<RunRecord>;
  updateRunStatus(runId: string, status: RunStatus, failureReason?: string): Promise<void>;
  setRunRuleInfo(runId: string, ruleId: string, ruleConfigHash: string): Promise<void>;
  findRunById(id: string): Promise<RunRecord | null>;
  listRuns(): Promise<RunRecord[]>;

  // Reconciliation rows + decisions
  insertReconciliationRows(runId: string, rows: ReconciliationRow[]): Promise<void>;
  listRunRows(runId: string, filter?: RowFilter): Promise<ReviewRowView[]>;
  getRunRow(runId: string, rowId: string): Promise<ReviewRowView | null>;
  getRowsByIds(runId: string, ids: string[]): Promise<ReviewRowView[]>;
  setDecision(
    reconciliationRowId: string,
    status: "PENDING" | "APPROVED" | "APPROVED_WARNING_ACK" | "REJECTED",
    warningsAtDecision: string[],
    decidedBy: string,
  ): Promise<void>;
  lockDecisionsForBatch(reconciliationRowIds: string[], batchId: string): Promise<void>;

  // Batches
  insertBatch(input: InsertBatchInput): Promise<BatchRecord>;
  findBatchById(id: string): Promise<BatchRecord | null>;
  listBatchesForRun(runId: string): Promise<BatchRecord[]>;
  listAllBatches(): Promise<BatchRecord[]>;
  updateBatchImportStatus(batchId: string, status: string): Promise<void>;

  // Legacy comparison
  insertLegacyComparison(
    runId: string,
    legacyFileId: string,
    createdBy: string,
    results: LegacyComparisonRowInput[],
  ): Promise<string>;
  getLegacyComparisonRows(comparisonId: string): Promise<Record<string, unknown>[]>;
  listLegacyComparisonsForRun(runId: string): Promise<Record<string, unknown>[]>;

  // Post-import verification
  insertPostImportVerification(
    batchId: string,
    postImportFileId: string,
    createdBy: string,
    results: PostImportVerificationRowInput[],
  ): Promise<string>;
  getPostImportVerificationRows(verificationId: string): Promise<Record<string, unknown>[]>;
  listPostImportVerificationsForBatch(batchId: string): Promise<Record<string, unknown>[]>;

  // Audit log
  insertAuditLog(input: AuditLogInput): Promise<void>;

  // Vendor configs
  listVendorConfigs(): Promise<VendorConfigRecord[]>;
  findVendorConfigByKey(key: string): Promise<VendorConfigRecord | null>;
  insertVendorConfig(input: InsertVendorConfigInput): Promise<VendorConfigRecord>;
  updateVendorConfig(key: string, patch: UpdateVendorConfigPatch): Promise<VendorConfigRecord>;
  /** Soft delete: sets is_active = false. */
  deactivateVendorConfig(key: string): Promise<void>;
}
