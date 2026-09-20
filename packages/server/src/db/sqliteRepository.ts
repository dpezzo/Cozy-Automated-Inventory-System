import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { ManagedValues, ReconciliationRow, WarehouseCode } from "@cozywinters/shared";
import type { Repository } from "./Repository";
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
  ReconciliationRowRecord,
  DecisionRecord,
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
  ClearDataCounts,
  ClearDataResult,
  VendorConfigRecord,
  InsertVendorConfigInput,
  UpdateVendorConfigPatch,
} from "./types";
import { DEFAULT_DATA_SIZE_ALERT_THRESHOLDS } from "./types";
import { defaultSqlitePath } from "../config/paths";
import { runSqliteMigrations } from "./sqliteMigrate";

function nowIso(): string {
  return new Date().toISOString();
}

function toIntBool(value: boolean): number {
  return value ? 1 : 0;
}

function fromIntBool(value: unknown): boolean {
  return Number(value) === 1;
}

function inClause(n: number): string {
  return `(${Array.from({ length: n }, () => "?").join(",")})`;
}

const DATA_SIZE_ALERT_SETTINGS_KEY = "data_size_alert_thresholds";

/**
 * password_hash stays NOT NULL at the schema level (see
 * migrations-sqlite/0002_users_roles_and_google.sql) -- a Google-only user
 * is stored with this sentinel instead of a real hash. It is never a valid
 * bcrypt hash, so bcrypt.compare against it always returns false.
 */
const PASSWORD_HASH_SENTINEL = "";

function mapUserRow(row: Record<string, unknown>): UserRecord {
  const passwordHash = row.password_hash as string;
  return {
    id: row.id as string,
    email: row.email as string,
    passwordHash: passwordHash === PASSWORD_HASH_SENTINEL ? null : passwordHash,
    role: row.role as UserRecord["role"],
    googleId: (row.google_id as string | null) ?? null,
    displayName: (row.display_name as string | null) ?? null,
    isActive: fromIntBool(row.is_active),
  };
}

export class SqliteRepository implements Repository {
  private db: DatabaseSync | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string = defaultSqlitePath()) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    runSqliteMigrations(this.dbPath);
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private conn(): DatabaseSync {
    if (!this.db) throw new Error("SqliteRepository.init() must be called before use.");
    return this.db;
  }

  /** Exposed for the SQLite-backed express-session store, which needs the raw connection. */
  getRawConnection(): DatabaseSync {
    return this.conn();
  }

  // ---------- Users ----------

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const row = this.conn()
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email.toLowerCase().trim()) as Record<string, unknown> | undefined;
    return row ? mapUserRow(row) : null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const row = this.conn().prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapUserRow(row) : null;
  }

  async findUserByGoogleId(googleId: string): Promise<UserRecord | null> {
    const row = this.conn().prepare("SELECT * FROM users WHERE google_id = ?").get(googleId) as
      | Record<string, unknown>
      | undefined;
    return row ? mapUserRow(row) : null;
  }

  async upsertUser(email: string, passwordHash: string): Promise<UserRecord> {
    const normalized = email.toLowerCase().trim();
    const existing = await this.findUserByEmail(normalized);
    const id = existing?.id ?? randomUUID();
    this.conn()
      .prepare(
        `INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash`,
      )
      .run(id, normalized, passwordHash);
    const row = this.conn().prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown>;
    return mapUserRow(row);
  }

  async listUsers(): Promise<UserRecord[]> {
    const rows = this.conn().prepare("SELECT * FROM users ORDER BY email").all() as Record<string, unknown>[];
    return rows.map(mapUserRow);
  }

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    const id = randomUUID();
    const normalized = input.email.toLowerCase().trim();
    this.conn()
      .prepare(
        `INSERT INTO users (id, email, password_hash, google_id, role, display_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        normalized,
        input.passwordHash ?? PASSWORD_HASH_SENTINEL,
        input.googleId ?? null,
        input.role,
        input.displayName ?? null,
      );
    const row = this.conn().prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown>;
    return mapUserRow(row);
  }

  async updateUser(id: string, patch: UpdateUserPatch): Promise<UserRecord> {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (patch.email !== undefined) {
      sets.push("email = ?");
      params.push(patch.email);
    }
    if (patch.role !== undefined) {
      sets.push("role = ?");
      params.push(patch.role);
    }
    if (patch.isActive !== undefined) {
      sets.push("is_active = ?");
      params.push(toIntBool(patch.isActive));
    }
    if (patch.displayName !== undefined) {
      sets.push("display_name = ?");
      params.push(patch.displayName);
    }
    if (patch.googleId !== undefined) {
      sets.push("google_id = ?");
      params.push(patch.googleId);
    }
    if (patch.passwordHash !== undefined) {
      sets.push("password_hash = ?");
      params.push(patch.passwordHash ?? PASSWORD_HASH_SENTINEL);
    }
    if (sets.length > 0) {
      this.conn()
        .prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
        .run(...params, id);
    }
    const row = this.conn().prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`User ${id} not found.`);
    return mapUserRow(row);
  }

  async deleteUser(id: string): Promise<void> {
    this.conn().prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(id);
  }

  // ---------- Files ----------

  async insertFile(input: InsertFileInput): Promise<FileRecord> {
    const id = randomUUID();
    const uploadedAt = nowIso();
    this.conn()
      .prepare(
        `INSERT INTO files (id, kind, original_filename, storage_path, checksum_sha256, size_bytes, row_count, uploaded_by, uploaded_at, vendor_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.kind,
        input.originalFilename,
        input.storagePath,
        input.checksumSha256,
        input.sizeBytes,
        input.rowCount ?? null,
        input.uploadedBy,
        uploadedAt,
        input.vendorKey ?? null,
      );
    return {
      id,
      kind: input.kind,
      originalFilename: input.originalFilename,
      storagePath: input.storagePath,
      checksumSha256: input.checksumSha256,
      sizeBytes: input.sizeBytes,
      rowCount: input.rowCount ?? null,
      uploadedAt,
      vendorKey: input.vendorKey ?? null,
    };
  }

  async findFileByChecksum(kind: FileKind, checksum: string): Promise<FileRecord | null> {
    const row = this.conn()
      .prepare("SELECT * FROM files WHERE kind = ? AND checksum_sha256 = ? ORDER BY uploaded_at DESC LIMIT 1")
      .get(kind, checksum) as Record<string, unknown> | undefined;
    return row ? mapFileRow(row) : null;
  }

  async findFileById(id: string): Promise<FileRecord | null> {
    const row = this.conn().prepare("SELECT * FROM files WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapFileRow(row) : null;
  }

  async listFiles(kind?: FileKind): Promise<FileRecord[]> {
    const rows = kind
      ? (this.conn().prepare("SELECT * FROM files WHERE kind = ? ORDER BY uploaded_at DESC LIMIT 50").all(kind) as Record<
          string,
          unknown
        >[])
      : (this.conn().prepare("SELECT * FROM files ORDER BY uploaded_at DESC LIMIT 50").all() as Record<string, unknown>[]);
    return rows.map(mapFileRow);
  }

  // ---------- Runs ----------

  async insertRun(input: InsertRunInput): Promise<RunRecord> {
    const id = randomUUID();
    const createdAt = nowIso();
    this.conn()
      .prepare(
        `INSERT INTO runs (id, vendor_file_id, miva_file_id, rule_id, rule_config_hash, run_date, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.vendorFileId,
        input.mivaFileId,
        input.ruleId,
        input.ruleConfigHash,
        input.runDate,
        input.status,
        input.createdBy,
        createdAt,
      );
    return {
      id,
      vendorFileId: input.vendorFileId,
      mivaFileId: input.mivaFileId,
      ruleId: input.ruleId,
      ruleConfigHash: input.ruleConfigHash,
      runDate: input.runDate,
      status: input.status,
      failureReason: null,
      createdAt,
      closedAt: null,
    };
  }

  async updateRunStatus(runId: string, status: RunStatus, failureReason?: string): Promise<void> {
    this.conn()
      .prepare("UPDATE runs SET status = ?, failure_reason = ? WHERE id = ?")
      .run(status, failureReason ?? null, runId);
  }

  async setRunRuleInfo(runId: string, ruleId: string, ruleConfigHash: string): Promise<void> {
    this.conn().prepare("UPDATE runs SET rule_id = ?, rule_config_hash = ? WHERE id = ?").run(ruleId, ruleConfigHash, runId);
  }

  async findRunById(id: string): Promise<RunRecord | null> {
    const row = this.conn().prepare("SELECT * FROM runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapRunRow(row) : null;
  }

  async listRuns(): Promise<RunRecord[]> {
    const rows = this.conn().prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT 50").all() as Record<
      string,
      unknown
    >[];
    return rows.map(mapRunRow);
  }

  // ---------- Reconciliation rows + decisions ----------

  async insertReconciliationRows(runId: string, rows: ReconciliationRow[]): Promise<void> {
    const db = this.conn();
    db.exec("BEGIN");
    try {
      const insertRow = db.prepare(
        `INSERT INTO reconciliation_rows
          (id, run_id, source_row_number, item_no, raw_upc, normalized_upc, description, product_code,
           match_outcome, review_class, warning_codes, blocker_codes, total_qty_raw,
           expected_date, expected_date_sources, current_values, proposed_values, changed, is_eligible_for_approval)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      const insertDecision = db.prepare(
        `INSERT INTO decisions (id, reconciliation_row_id, run_id, status, warnings_at_decision) VALUES (?, ?, ?, 'PENDING', '[]')`,
      );
      for (const r of rows) {
        const id = randomUUID();
        insertRow.run(
          id,
          runId,
          r.sourceRowNumber,
          r.itemNo,
          r.rawUpc,
          r.normalizedUpc,
          r.description,
          r.productCode,
          r.matchOutcome,
          r.reviewClass,
          JSON.stringify(r.warningCodes),
          JSON.stringify(r.blockerCodes),
          r.totalQtyRaw,
          r.expectedDate,
          JSON.stringify(r.expectedDateSources),
          JSON.stringify(r.current),
          JSON.stringify(r.proposed),
          toIntBool(r.changed),
          toIntBool(r.isEligibleForApproval),
        );
        insertDecision.run(randomUUID(), id, runId);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  async listRunRows(runId: string, filter: RowFilter = {}): Promise<ReviewRowView[]> {
    const clauses: string[] = ["rr.run_id = ?"];
    const params: (string | number)[] = [runId];

    if (filter.reviewClass && filter.reviewClass.length > 0) {
      clauses.push(`rr.review_class IN (${filter.reviewClass.map(() => "?").join(",")})`);
      params.push(...filter.reviewClass);
    }
    if (filter.changed !== undefined) {
      clauses.push("rr.changed = ?");
      params.push(toIntBool(filter.changed));
    }
    if (filter.decisionStatus && filter.decisionStatus.length > 0) {
      clauses.push(`d.status IN (${filter.decisionStatus.map(() => "?").join(",")})`);
      params.push(...filter.decisionStatus);
    }
    if (filter.matchOutcome && filter.matchOutcome.length > 0) {
      clauses.push(`rr.match_outcome IN (${filter.matchOutcome.map(() => "?").join(",")})`);
      params.push(...filter.matchOutcome);
    }
    if (filter.search) {
      const term = `%${filter.search.toLowerCase()}%`;
      clauses.push(
        "(LOWER(COALESCE(rr.item_no, '')) LIKE ? OR LOWER(COALESCE(rr.product_code, '')) LIKE ? OR LOWER(COALESCE(rr.raw_upc, '')) LIKE ?)",
      );
      params.push(term, term, term);
    }

    const rows = this.conn()
      .prepare(
        `SELECT rr.*, d.id AS decision_id, d.status AS decision_status, d.warnings_at_decision, d.decided_at, d.batch_id, d.locked
         FROM reconciliation_rows rr
         JOIN decisions d ON d.reconciliation_row_id = rr.id
         WHERE ${clauses.join(" AND ")}
         ORDER BY (rr.source_row_number IS NULL), rr.source_row_number, rr.product_code`,
      )
      .all(...params) as Record<string, unknown>[];

    return rows.map(mapReviewRowView);
  }

  async getRunRow(runId: string, rowId: string): Promise<ReviewRowView | null> {
    const row = this.conn()
      .prepare(
        `SELECT rr.*, d.id AS decision_id, d.status AS decision_status, d.warnings_at_decision, d.decided_at, d.batch_id, d.locked
         FROM reconciliation_rows rr
         JOIN decisions d ON d.reconciliation_row_id = rr.id
         WHERE rr.run_id = ? AND rr.id = ?`,
      )
      .get(runId, rowId) as Record<string, unknown> | undefined;
    return row ? mapReviewRowView(row) : null;
  }

  async getRowsByIds(runId: string, ids: string[]): Promise<ReviewRowView[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.conn()
      .prepare(
        `SELECT rr.*, d.id AS decision_id, d.status AS decision_status, d.warnings_at_decision, d.decided_at, d.batch_id, d.locked
         FROM reconciliation_rows rr
         JOIN decisions d ON d.reconciliation_row_id = rr.id
         WHERE rr.run_id = ? AND rr.id IN (${placeholders})`,
      )
      .all(runId, ...ids) as Record<string, unknown>[];
    return rows.map(mapReviewRowView);
  }

  async setDecision(
    reconciliationRowId: string,
    status: DecisionRecord["status"],
    warningsAtDecision: string[],
    decidedBy: string,
  ): Promise<void> {
    this.conn()
      .prepare(
        `UPDATE decisions
         SET status = ?, warnings_at_decision = ?, decided_by = ?, decided_at = ?
         WHERE reconciliation_row_id = ? AND locked = 0`,
      )
      .run(status, JSON.stringify(warningsAtDecision), decidedBy, nowIso(), reconciliationRowId);
  }

  async lockDecisionsForBatch(reconciliationRowIds: string[], batchId: string): Promise<void> {
    if (reconciliationRowIds.length === 0) return;
    const db = this.conn();
    const stmt = db.prepare("UPDATE decisions SET locked = 1, batch_id = ? WHERE reconciliation_row_id = ?");
    db.exec("BEGIN");
    try {
      for (const id of reconciliationRowIds) stmt.run(batchId, id);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  // ---------- Batches ----------

  async insertBatch(input: InsertBatchInput): Promise<BatchRecord> {
    const id = randomUUID();
    const createdAt = nowIso();
    this.conn()
      .prepare(
        `INSERT INTO batches (id, run_id, update_file_id, rollback_file_id, exception_file_id, reconciliation_file_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId,
        input.updateFileId,
        input.rollbackFileId,
        input.exceptionFileId,
        input.reconciliationFileId,
        input.createdBy,
        createdAt,
      );
    return {
      id,
      runId: input.runId,
      updateFileId: input.updateFileId,
      rollbackFileId: input.rollbackFileId,
      exceptionFileId: input.exceptionFileId,
      reconciliationFileId: input.reconciliationFileId,
      importStatus: "GENERATED",
      createdAt,
    };
  }

  async findBatchById(id: string): Promise<BatchRecord | null> {
    const row = this.conn().prepare("SELECT * FROM batches WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapBatchRow(row) : null;
  }

  async listBatchesForRun(runId: string): Promise<BatchRecord[]> {
    const rows = this.conn().prepare("SELECT * FROM batches WHERE run_id = ? ORDER BY created_at DESC").all(runId) as Record<
      string,
      unknown
    >[];
    return rows.map(mapBatchRow);
  }

  async listAllBatches(): Promise<BatchRecord[]> {
    const rows = this.conn().prepare("SELECT * FROM batches ORDER BY created_at DESC LIMIT 50").all() as Record<
      string,
      unknown
    >[];
    return rows.map(mapBatchRow);
  }

  async updateBatchImportStatus(batchId: string, status: string): Promise<void> {
    this.conn().prepare("UPDATE batches SET import_status = ? WHERE id = ?").run(status, batchId);
  }

  // ---------- Legacy comparison ----------

  async insertLegacyComparison(
    runId: string,
    legacyFileId: string,
    createdBy: string,
    results: LegacyComparisonRowInput[],
  ): Promise<string> {
    const db = this.conn();
    const comparisonId = randomUUID();
    db.exec("BEGIN");
    try {
      db.prepare("INSERT INTO legacy_comparisons (id, run_id, legacy_file_id, created_by) VALUES (?, ?, ?, ?)").run(
        comparisonId,
        runId,
        legacyFileId,
        createdBy,
      );
      const insertRow = db.prepare(
        `INSERT INTO legacy_comparison_rows (id, legacy_comparison_id, source_row_number, product_code, comparison_class, deviation_id, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of results) {
        insertRow.run(randomUUID(), comparisonId, r.sourceRowNumber, r.productCode, r.comparisonClass, r.deviationId, r.note);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return comparisonId;
  }

  async getLegacyComparisonRows(comparisonId: string): Promise<Record<string, unknown>[]> {
    return this.conn()
      .prepare(
        "SELECT * FROM legacy_comparison_rows WHERE legacy_comparison_id = ? ORDER BY (source_row_number IS NULL), source_row_number, product_code",
      )
      .all(comparisonId) as Record<string, unknown>[];
  }

  async listLegacyComparisonsForRun(runId: string): Promise<Record<string, unknown>[]> {
    return this.conn().prepare("SELECT * FROM legacy_comparisons WHERE run_id = ? ORDER BY created_at DESC").all(
      runId,
    ) as Record<string, unknown>[];
  }

  // ---------- Post-import verification ----------

  async insertPostImportVerification(
    batchId: string,
    postImportFileId: string,
    createdBy: string,
    results: PostImportVerificationRowInput[],
  ): Promise<string> {
    const db = this.conn();
    const verificationId = randomUUID();
    db.exec("BEGIN");
    try {
      db.prepare("INSERT INTO post_import_verifications (id, batch_id, post_import_file_id, created_by) VALUES (?, ?, ?, ?)").run(
        verificationId,
        batchId,
        postImportFileId,
        createdBy,
      );
      const insertRow = db.prepare(
        "INSERT INTO post_import_verification_rows (id, verification_id, product_code, result, reason) VALUES (?, ?, ?, ?, ?)",
      );
      for (const r of results) {
        insertRow.run(randomUUID(), verificationId, r.productCode, r.result, r.reason);
      }
      const anyFail = results.some((r) => r.result === "FAIL");
      db.prepare("UPDATE batches SET import_status = ? WHERE id = ?").run(
        anyFail ? "VERIFICATION_FAILED" : "VERIFIED",
        batchId,
      );
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return verificationId;
  }

  async getPostImportVerificationRows(verificationId: string): Promise<Record<string, unknown>[]> {
    return this.conn().prepare("SELECT * FROM post_import_verification_rows WHERE verification_id = ? ORDER BY product_code").all(
      verificationId,
    ) as Record<string, unknown>[];
  }

  async listPostImportVerificationsForBatch(batchId: string): Promise<Record<string, unknown>[]> {
    return this.conn()
      .prepare("SELECT * FROM post_import_verifications WHERE batch_id = ? ORDER BY created_at DESC")
      .all(batchId) as Record<string, unknown>[];
  }

  // ---------- Audit log ----------

  async insertAuditLog(input: AuditLogInput): Promise<void> {
    this.conn()
      .prepare("INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), input.actorId, input.action, input.entityType, input.entityId, JSON.stringify(input.details ?? {}));
  }

  async getDataStats(): Promise<DataStats> {
    const rows = this.conn().prepare("SELECT COUNT(*) AS c FROM reconciliation_rows").get() as { c: number };
    const files = this.conn().prepare("SELECT COALESCE(SUM(size_bytes), 0) AS b FROM files").get() as { b: number };
    return { reconciliationRows: rows.c, totalFileBytes: files.b, thresholds: this.readDataSizeAlertThresholds() };
  }

  private readDataSizeAlertThresholds(): DataSizeAlertThresholds {
    const row = this.conn().prepare("SELECT value FROM app_settings WHERE key = ?").get(DATA_SIZE_ALERT_SETTINGS_KEY) as
      | { value: string }
      | undefined;
    if (!row) return DEFAULT_DATA_SIZE_ALERT_THRESHOLDS;
    try {
      return { ...DEFAULT_DATA_SIZE_ALERT_THRESHOLDS, ...JSON.parse(row.value) };
    } catch {
      return DEFAULT_DATA_SIZE_ALERT_THRESHOLDS;
    }
  }

  async setDataSizeAlertThresholds(thresholds: DataSizeAlertThresholds): Promise<void> {
    this.conn()
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(DATA_SIZE_ALERT_SETTINGS_KEY, JSON.stringify(thresholds), nowIso());
  }

  async resetDataSizeAlertThresholds(): Promise<void> {
    this.conn().prepare("DELETE FROM app_settings WHERE key = ?").run(DATA_SIZE_ALERT_SETTINGS_KEY);
  }

  async previewClearData(beforeDate: string | null): Promise<ClearDataCounts> {
    const { deletedFileStoragePaths, ...counts } = await this.runClearData(beforeDate, true);
    return counts;
  }

  async clearData(beforeDate: string | null): Promise<ClearDataResult> {
    return this.runClearData(beforeDate, false);
  }

  /**
   * Deletes in dependency order (children before parents -- see the FK
   * layout in migrations/0001_init.sql: only reconciliation_rows/decisions/
   * legacy_comparison_rows/post_import_verification_rows cascade from their
   * direct parent; runs/batches/files relationships do not), then figures
   * out which of the files referenced by the deleted rows are now
   * unreferenced anywhere else (a file can be reused across runs via the
   * checksum-dedupe upload flow) before deleting those file rows too.
   * dryRun runs the identical logic and rolls back instead of committing, so
   * the preview is guaranteed to match what a real run would do.
   */
  private async runClearData(beforeDate: string | null, dryRun: boolean): Promise<ClearDataResult> {
    const db = this.conn();
    const empty: ClearDataResult = {
      runs: 0,
      batches: 0,
      reconciliationRows: 0,
      decisions: 0,
      legacyComparisons: 0,
      postImportVerifications: 0,
      files: 0,
      totalFileBytes: 0,
      deletedFileStoragePaths: [],
    };

    db.exec("BEGIN");
    try {
      const runRows = (
        beforeDate
          ? db.prepare("SELECT id FROM runs WHERE created_at < ?").all(beforeDate)
          : db.prepare("SELECT id FROM runs").all()
      ) as { id: string }[];
      const runIds = runRows.map((r) => r.id);

      if (runIds.length === 0) {
        db.exec("ROLLBACK");
        return empty;
      }
      const runPh = inClause(runIds.length);

      const batchRows = db
        .prepare(
          `SELECT id, update_file_id, rollback_file_id, exception_file_id, reconciliation_file_id
           FROM batches WHERE run_id IN ${runPh}`,
        )
        .all(...runIds) as Record<string, unknown>[];
      const batchIds = batchRows.map((b) => b.id as string);
      const batchPh = batchIds.length ? inClause(batchIds.length) : null;

      const runFileRows = db.prepare(`SELECT vendor_file_id, miva_file_id FROM runs WHERE id IN ${runPh}`).all(...runIds) as {
        vendor_file_id: string;
        miva_file_id: string;
      }[];
      const legacyRows = db.prepare(`SELECT legacy_file_id FROM legacy_comparisons WHERE run_id IN ${runPh}`).all(...runIds) as {
        legacy_file_id: string | null;
      }[];
      const postImportRows = batchPh
        ? (db.prepare(`SELECT post_import_file_id FROM post_import_verifications WHERE batch_id IN ${batchPh}`).all(
            ...batchIds,
          ) as { post_import_file_id: string | null }[])
        : [];

      const candidateFileIds = new Set<string>();
      for (const r of runFileRows) {
        candidateFileIds.add(r.vendor_file_id);
        candidateFileIds.add(r.miva_file_id);
      }
      for (const b of batchRows) {
        for (const col of ["update_file_id", "rollback_file_id", "exception_file_id", "reconciliation_file_id"] as const) {
          const v = b[col] as string | null;
          if (v) candidateFileIds.add(v);
        }
      }
      for (const r of legacyRows) if (r.legacy_file_id) candidateFileIds.add(r.legacy_file_id);
      for (const r of postImportRows) if (r.post_import_file_id) candidateFileIds.add(r.post_import_file_id);

      const reconciliationRows = (
        db.prepare(`SELECT COUNT(*) AS c FROM reconciliation_rows WHERE run_id IN ${runPh}`).get(...runIds) as { c: number }
      ).c;
      const decisions = (db.prepare(`SELECT COUNT(*) AS c FROM decisions WHERE run_id IN ${runPh}`).get(...runIds) as { c: number })
        .c;

      // Children first, then the run itself -- see the ordering note above.
      if (batchPh) {
        db.prepare(
          `DELETE FROM post_import_verification_rows
           WHERE verification_id IN (SELECT id FROM post_import_verifications WHERE batch_id IN ${batchPh})`,
        ).run(...batchIds);
        db.prepare(`DELETE FROM post_import_verifications WHERE batch_id IN ${batchPh}`).run(...batchIds);
      }
      db.prepare(
        `DELETE FROM legacy_comparison_rows
         WHERE legacy_comparison_id IN (SELECT id FROM legacy_comparisons WHERE run_id IN ${runPh})`,
      ).run(...runIds);
      db.prepare(`DELETE FROM legacy_comparisons WHERE run_id IN ${runPh}`).run(...runIds);
      db.prepare(`DELETE FROM decisions WHERE run_id IN ${runPh}`).run(...runIds);
      if (batchPh) {
        db.prepare(`DELETE FROM batches WHERE id IN ${batchPh}`).run(...batchIds);
      }
      db.prepare(`DELETE FROM reconciliation_rows WHERE run_id IN ${runPh}`).run(...runIds);
      db.prepare(`DELETE FROM runs WHERE id IN ${runPh}`).run(...runIds);

      // Only drop files nothing else still points at -- the same file can be
      // reused across runs via the checksum-dedupe upload flow.
      const fileIdList = Array.from(candidateFileIds);
      const deletableFileIds: string[] = [];
      for (const fid of fileIdList) {
        const stillReferenced =
          Boolean(db.prepare("SELECT 1 FROM runs WHERE vendor_file_id = ? OR miva_file_id = ? LIMIT 1").get(fid, fid)) ||
          Boolean(
            db
              .prepare(
                "SELECT 1 FROM batches WHERE update_file_id = ? OR rollback_file_id = ? OR exception_file_id = ? OR reconciliation_file_id = ? LIMIT 1",
              )
              .get(fid, fid, fid, fid),
          ) ||
          Boolean(db.prepare("SELECT 1 FROM legacy_comparisons WHERE legacy_file_id = ? LIMIT 1").get(fid)) ||
          Boolean(db.prepare("SELECT 1 FROM post_import_verifications WHERE post_import_file_id = ? LIMIT 1").get(fid));
        if (!stillReferenced) deletableFileIds.push(fid);
      }

      let totalFileBytes = 0;
      let deletedFileStoragePaths: string[] = [];
      if (deletableFileIds.length > 0) {
        const filePh = inClause(deletableFileIds.length);
        const fileRows = db.prepare(`SELECT storage_path, size_bytes FROM files WHERE id IN ${filePh}`).all(
          ...deletableFileIds,
        ) as { storage_path: string; size_bytes: number }[];
        totalFileBytes = fileRows.reduce((sum, f) => sum + (f.size_bytes ?? 0), 0);
        deletedFileStoragePaths = fileRows.map((f) => f.storage_path);
        db.prepare(`DELETE FROM files WHERE id IN ${filePh}`).run(...deletableFileIds);
      }

      const result: ClearDataResult = {
        runs: runIds.length,
        batches: batchIds.length,
        reconciliationRows,
        decisions,
        legacyComparisons: legacyRows.length,
        postImportVerifications: postImportRows.length,
        files: deletableFileIds.length,
        totalFileBytes,
        deletedFileStoragePaths,
      };

      db.exec(dryRun ? "ROLLBACK" : "COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  async listAuditLog(limit = 200): Promise<AuditLogRecord[]> {
    const rows = this.conn()
      .prepare(
        `SELECT audit_log.*, users.email AS actor_email
         FROM audit_log
         LEFT JOIN users ON users.id = audit_log.actor_id
         ORDER BY audit_log.created_at DESC
         LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map(mapAuditLogRow);
  }

  // ---------- Vendor configs ----------

  async listVendorConfigs(): Promise<VendorConfigRecord[]> {
    const rows = this.conn().prepare("SELECT * FROM vendor_configs ORDER BY vendor_label").all() as Record<
      string,
      unknown
    >[];
    return rows.map(mapVendorConfigRow);
  }

  async findVendorConfigByKey(key: string): Promise<VendorConfigRecord | null> {
    const row = this.conn().prepare("SELECT * FROM vendor_configs WHERE vendor_key = ?").get(key) as
      | Record<string, unknown>
      | undefined;
    return row ? mapVendorConfigRow(row) : null;
  }

  async insertVendorConfig(input: InsertVendorConfigInput): Promise<VendorConfigRecord> {
    const now = nowIso();
    this.conn()
      .prepare(
        `INSERT INTO vendor_configs
          (vendor_key, vendor_label, in_stock_threshold, timezone, brand_allowlist, match_strategy, missing_blocker_code, file_shape, column_mapping, plugin_filename, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.vendorKey,
        input.vendorLabel,
        input.inStockThreshold,
        input.timezone,
        JSON.stringify(input.brandAllowlist),
        input.matchStrategy,
        input.missingBlockerCode ?? null,
        input.fileShape,
        input.columnMapping ? JSON.stringify(input.columnMapping) : null,
        input.pluginFilename ?? null,
        now,
        now,
      );
    const row = this.conn().prepare("SELECT * FROM vendor_configs WHERE vendor_key = ?").get(input.vendorKey) as Record<
      string,
      unknown
    >;
    return mapVendorConfigRow(row);
  }

  async updateVendorConfig(key: string, patch: UpdateVendorConfigPatch): Promise<VendorConfigRecord> {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (patch.vendorLabel !== undefined) {
      sets.push("vendor_label = ?");
      params.push(patch.vendorLabel);
    }
    if (patch.inStockThreshold !== undefined) {
      sets.push("in_stock_threshold = ?");
      params.push(patch.inStockThreshold);
    }
    if (patch.timezone !== undefined) {
      sets.push("timezone = ?");
      params.push(patch.timezone);
    }
    if (patch.brandAllowlist !== undefined) {
      sets.push("brand_allowlist = ?");
      params.push(JSON.stringify(patch.brandAllowlist));
    }
    if (patch.matchStrategy !== undefined) {
      sets.push("match_strategy = ?");
      params.push(patch.matchStrategy);
    }
    if (patch.columnMapping !== undefined) {
      sets.push("column_mapping = ?");
      params.push(patch.columnMapping ? JSON.stringify(patch.columnMapping) : null);
    }
    if (patch.isActive !== undefined) {
      sets.push("is_active = ?");
      params.push(toIntBool(patch.isActive));
    }
    sets.push("updated_at = ?");
    params.push(nowIso());
    this.conn()
      .prepare(`UPDATE vendor_configs SET ${sets.join(", ")} WHERE vendor_key = ?`)
      .run(...params, key);
    const row = this.conn().prepare("SELECT * FROM vendor_configs WHERE vendor_key = ?").get(key) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new Error(`Vendor config ${key} not found.`);
    return mapVendorConfigRow(row);
  }

  async deactivateVendorConfig(key: string): Promise<void> {
    this.conn()
      .prepare("UPDATE vendor_configs SET is_active = 0, updated_at = ? WHERE vendor_key = ?")
      .run(nowIso(), key);
  }
}

function mapFileRow(row: Record<string, unknown>): FileRecord {
  return {
    id: row.id as string,
    kind: row.kind as FileKind,
    originalFilename: row.original_filename as string,
    storagePath: row.storage_path as string,
    checksumSha256: row.checksum_sha256 as string,
    sizeBytes: Number(row.size_bytes),
    rowCount: row.row_count === null || row.row_count === undefined ? null : Number(row.row_count),
    uploadedAt: row.uploaded_at as string,
    vendorKey: (row.vendor_key as string | null) ?? null,
  };
}

function mapVendorConfigRow(row: Record<string, unknown>): VendorConfigRecord {
  return {
    vendorKey: row.vendor_key as string,
    vendorLabel: row.vendor_label as string,
    inStockThreshold: Number(row.in_stock_threshold),
    timezone: row.timezone as string,
    brandAllowlist: JSON.parse((row.brand_allowlist as string) ?? "[]"),
    matchStrategy: row.match_strategy as VendorConfigRecord["matchStrategy"],
    missingBlockerCode: (row.missing_blocker_code as VendorConfigRecord["missingBlockerCode"]) ?? null,
    fileShape: row.file_shape as VendorConfigRecord["fileShape"],
    columnMapping: row.column_mapping ? JSON.parse(row.column_mapping as string) : null,
    pluginFilename: (row.plugin_filename as string | null) ?? null,
    isActive: fromIntBool(row.is_active),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapAuditLogRow(row: Record<string, unknown>): AuditLogRecord {
  return {
    id: row.id as string,
    actorId: (row.actor_id as string | null) ?? null,
    actorEmail: (row.actor_email as string | null) ?? null,
    action: row.action as string,
    entityType: row.entity_type as string,
    entityId: (row.entity_id as string | null) ?? null,
    details: JSON.parse((row.details as string) ?? "{}"),
    createdAt: row.created_at as string,
  };
}

function mapRunRow(row: Record<string, unknown>): RunRecord {
  return {
    id: row.id as string,
    vendorFileId: row.vendor_file_id as string,
    mivaFileId: row.miva_file_id as string,
    ruleId: row.rule_id as string,
    ruleConfigHash: row.rule_config_hash as string,
    runDate: row.run_date as string,
    status: row.status as RunStatus,
    failureReason: (row.failure_reason as string | null) ?? null,
    createdAt: row.created_at as string,
    closedAt: (row.closed_at as string | null) ?? null,
  };
}

function mapBatchRow(row: Record<string, unknown>): BatchRecord {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    updateFileId: (row.update_file_id as string) ?? null,
    rollbackFileId: (row.rollback_file_id as string) ?? null,
    exceptionFileId: (row.exception_file_id as string) ?? null,
    reconciliationFileId: (row.reconciliation_file_id as string) ?? null,
    importStatus: row.import_status as string,
    createdAt: row.created_at as string,
  };
}

function mapReviewRowView(row: Record<string, unknown>): ReviewRowView {
  const current = JSON.parse(row.current_values as string) as Partial<ManagedValues>;
  const proposed = JSON.parse(row.proposed_values as string) as Partial<ManagedValues>;
  const reconRow: ReconciliationRowRecord = {
    id: row.id as string,
    runId: row.run_id as string,
    sourceRowNumber: row.source_row_number === null ? null : Number(row.source_row_number),
    itemNo: (row.item_no as string) ?? null,
    rawUpc: (row.raw_upc as string) ?? null,
    normalizedUpc: (row.normalized_upc as string) ?? null,
    description: (row.description as string) ?? null,
    productCode: (row.product_code as string) ?? null,
    matchOutcome: row.match_outcome as ReconciliationRow["matchOutcome"],
    reviewClass: row.review_class as ReconciliationRow["reviewClass"],
    warningCodes: JSON.parse((row.warning_codes as string) ?? "[]"),
    blockerCodes: JSON.parse((row.blocker_codes as string) ?? "[]"),
    totalQtyRaw: (row.total_qty_raw as string) ?? null,
    expectedDate: (row.expected_date as string) ?? null,
    expectedDateSources: JSON.parse((row.expected_date_sources as string) ?? "[]") as WarehouseCode[],
    current,
    proposed,
    changed: fromIntBool(row.changed),
    isEligibleForApproval: fromIntBool(row.is_eligible_for_approval),
  };
  const decision: DecisionRecord = {
    id: row.decision_id as string,
    reconciliationRowId: row.id as string,
    runId: row.run_id as string,
    status: row.decision_status as DecisionRecord["status"],
    warningsAtDecision: JSON.parse((row.warnings_at_decision as string) ?? "[]"),
    decidedAt: (row.decided_at as string) ?? null,
    batchId: (row.batch_id as string) ?? null,
    locked: fromIntBool(row.locked),
  };
  return { row: reconRow, decision };
}
