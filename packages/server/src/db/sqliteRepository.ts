import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { ManagedValues, ReconciliationRow, WarehouseCode } from "@cozywinters/shared";
import type { Repository } from "./Repository";
import type {
  UserRecord,
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
} from "./types";
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
      .prepare("SELECT id, email, password_hash FROM users WHERE email = ?")
      .get(email.toLowerCase().trim()) as Record<string, unknown> | undefined;
    return row ? { id: row.id as string, email: row.email as string, passwordHash: row.password_hash as string } : null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const row = this.conn().prepare("SELECT id, email, password_hash FROM users WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? { id: row.id as string, email: row.email as string, passwordHash: row.password_hash as string } : null;
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
    return { id, email: normalized, passwordHash };
  }

  // ---------- Files ----------

  async insertFile(input: InsertFileInput): Promise<FileRecord> {
    const id = randomUUID();
    const uploadedAt = nowIso();
    this.conn()
      .prepare(
        `INSERT INTO files (id, kind, original_filename, storage_path, checksum_sha256, size_bytes, row_count, uploaded_by, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
