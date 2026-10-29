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
  AuditLogRecord,
  DataStats,
  DataSizeAlertThresholds,
  MivaActiveSite,
  ClearDataCounts,
  ClearDataResult,
  ClearDataScope,
  VendorConfigRecord,
  InsertVendorConfigInput,
  UpdateVendorConfigPatch,
  DiscontinuedItemInput,
  DiscontinuedItemRecord,
  UpsertDiscontinuedItemsResult,
  CatalogViewRecord,
  InsertCatalogViewInput,
  UpdateCatalogViewPatch,
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
  markBatchRolledBack(batchId: string): Promise<void>;

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
  listAuditLog(limit?: number): Promise<AuditLogRecord[]>;

  /**
   * Admin data clearing, scoped per-category by the caller (see ClearDataScope):
   * run history (runs and everything hanging off them), Miva catalog snapshot
   * files not referenced by anything kept, and/or the activity log -- plus the
   * files that become orphaned as a result, both the DB rows and (via the
   * returned storage paths) the files on disk. Users and vendor configs are
   * never touched by any scope. previewClearData runs the exact same logic
   * and rolls back instead of committing, so the preview counts are
   * guaranteed to match a real run.
   */
  previewClearData(scope: ClearDataScope): Promise<ClearDataCounts>;
  clearData(scope: ClearDataScope): Promise<ClearDataResult>;

  /** Cheap overall-size stats (no per-run breakdown) for the storage-growth alert every signed-in user sees -- unlike previewClearData, this is just two aggregate queries, safe to call on every page load. Includes the current alert thresholds so the client never has to fetch them separately. */
  getDataStats(): Promise<DataStats>;
  /** Admin-only: where the alert thresholds live (app_settings), read back via getDataStats(). */
  setDataSizeAlertThresholds(thresholds: DataSizeAlertThresholds): Promise<void>;
  /** Clears any saved override, so getDataStats() falls back to DEFAULT_DATA_SIZE_ALERT_THRESHOLDS again. */
  resetDataSizeAlertThresholds(): Promise<void>;

  /** Which Miva store (credentials + push-confirmation gate) is active. Defaults to "development" when never set -- see resolveMivaPushEnvironment() in mivaApiPush.ts, the single source of truth this setting drives. */
  getMivaActiveSite(): Promise<MivaActiveSite>;
  setMivaActiveSite(site: MivaActiveSite): Promise<void>;

  /** Points at the `files` row (kind "dev_reset_reference") holding the current dev-site reset reference CSV. Null until one has ever been uploaded. */
  getDevResetReferenceFileId(): Promise<string | null>;
  setDevResetReferenceFileId(fileId: string): Promise<void>;

  /** Who receives the batch push/rollback summary email (Settings > Email Reports). Defaults to "dev@delutti.com" when never set. */
  getReportRecipientEmail(): Promise<string>;
  setReportRecipientEmail(email: string): Promise<void>;

  /** Whether batch push/rollback summary emails are sent at all. Defaults to true when never set. */
  getReportEnabled(): Promise<boolean>;
  setReportEnabled(enabled: boolean): Promise<void>;

  /** How many minutes of inactivity before a signed-in session is logged out client-side (Settings > Session Timeout). Defaults to 30 when never set. */
  getIdleTimeoutMinutes(): Promise<number>;
  setIdleTimeoutMinutes(minutes: number): Promise<void>;
  /** Raw app_settings value, or null if never set. Used by feature switches (see domain/featureFlags.ts). */
  getAppSetting(key: string): Promise<string | null>;
  setAppSetting(key: string, value: string): Promise<void>;

  // Vendor configs
  listVendorConfigs(): Promise<VendorConfigRecord[]>;
  findVendorConfigByKey(key: string): Promise<VendorConfigRecord | null>;
  insertVendorConfig(input: InsertVendorConfigInput): Promise<VendorConfigRecord>;
  updateVendorConfig(key: string, patch: UpdateVendorConfigPatch): Promise<VendorConfigRecord>;
  /** Soft delete: sets is_active = false. */
  deactivateVendorConfig(key: string): Promise<void>;

  // Vendor discontinued items (the cumulative list behind the Olliix "Discontinued Items Notification" upload)
  /** Inserts new UPCs and refreshes existing ones; never removes anything, so a shorter later list cannot un-discontinue an earlier item. */
  upsertDiscontinuedItems(vendorKey: string, items: DiscontinuedItemInput[], sourceFileId: string): Promise<UpsertDiscontinuedItemsResult>;
  listDiscontinuedItems(vendorKey: string): Promise<DiscontinuedItemRecord[]>;
  /** Just the normalized UPCs, for the rule engine's overlay. */
  listDiscontinuedUpcs(vendorKey: string): Promise<string[]>;

  // Catalog views (saved column/filter/sort setups) and which one opens by default
  /** The user's own views plus every shared view, newest first. */
  listCatalogViewsVisibleTo(userId: string): Promise<CatalogViewRecord[]>;
  findCatalogViewById(id: string): Promise<CatalogViewRecord | null>;
  insertCatalogView(input: InsertCatalogViewInput): Promise<CatalogViewRecord>;
  updateCatalogView(id: string, patch: UpdateCatalogViewPatch): Promise<CatalogViewRecord>;
  /** Also clears any default that pointed at it. */
  deleteCatalogView(id: string): Promise<void>;
  /** scope is "team" or "user:<id>". Returns the view id (a catalog_views id or a built-in id), or null. */
  getCatalogViewDefault(scope: string): Promise<string | null>;
  /** null clears the default for that scope. */
  setCatalogViewDefault(scope: string, viewId: string | null): Promise<void>;
}
