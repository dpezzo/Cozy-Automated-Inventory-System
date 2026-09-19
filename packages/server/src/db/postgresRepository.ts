import { Pool } from "pg";
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

/**
 * Optional PostgreSQL/Docker persistence path. Implements the same
 * Repository contract as SqliteRepository (the default, native path) so
 * neither the domain services nor the reconciliation rules know or care
 * which backend is active.
 */
export class PostgresRepository implements Repository {
  private pool: Pool | null = null;

  async init(): Promise<void> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL environment variable is required for DB_DRIVER=postgres.");
    this.pool = new Pool({ connectionString });
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }

  /** Exposed for express-session's connect-pg-simple store, which needs a raw pool. */
  getPool(): Pool {
    if (!this.pool) throw new Error("PostgresRepository.init() must be called before use.");
    return this.pool;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const { rows } = await this.getPool().query("SELECT id, email, password_hash FROM users WHERE email = $1", [
      email.toLowerCase().trim(),
    ]);
    if (rows.length === 0) return null;
    return { id: rows[0].id, email: rows[0].email, passwordHash: rows[0].password_hash };
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.getPool().query("SELECT id, email, password_hash FROM users WHERE id = $1", [id]);
    if (rows.length === 0) return null;
    return { id: rows[0].id, email: rows[0].email, passwordHash: rows[0].password_hash };
  }

  async upsertUser(email: string, passwordHash: string): Promise<UserRecord> {
    const normalized = email.toLowerCase().trim();
    const { rows } = await this.getPool().query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id, email, password_hash`,
      [normalized, passwordHash],
    );
    return { id: rows[0].id, email: rows[0].email, passwordHash: rows[0].password_hash };
  }

  async insertFile(input: InsertFileInput): Promise<FileRecord> {
    const { rows } = await this.getPool().query(
      `INSERT INTO files (kind, original_filename, storage_path, checksum_sha256, size_bytes, row_count, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, kind, original_filename, storage_path, checksum_sha256, size_bytes, row_count, uploaded_at`,
      [input.kind, input.originalFilename, input.storagePath, input.checksumSha256, input.sizeBytes, input.rowCount ?? null, input.uploadedBy],
    );
    return mapFileRow(rows[0]);
  }

  async findFileByChecksum(kind: FileKind, checksum: string): Promise<FileRecord | null> {
    const { rows } = await this.getPool().query(
      "SELECT * FROM files WHERE kind = $1 AND checksum_sha256 = $2 ORDER BY uploaded_at DESC LIMIT 1",
      [kind, checksum],
    );
    if (rows.length === 0) return null;
    return mapFileRow(rows[0]);
  }

  async findFileById(id: string): Promise<FileRecord | null> {
    const { rows } = await this.getPool().query("SELECT * FROM files WHERE id = $1", [id]);
    if (rows.length === 0) return null;
    return mapFileRow(rows[0]);
  }

  async listFiles(kind?: FileKind): Promise<FileRecord[]> {
    const { rows } = kind
      ? await this.getPool().query("SELECT * FROM files WHERE kind = $1 ORDER BY uploaded_at DESC LIMIT 50", [kind])
      : await this.getPool().query("SELECT * FROM files ORDER BY uploaded_at DESC LIMIT 50");
    return rows.map(mapFileRow);
  }

  async insertRun(input: InsertRunInput): Promise<RunRecord> {
    const { rows } = await this.getPool().query(
      `INSERT INTO runs (olliix_file_id, miva_file_id, rule_id, rule_config_hash, run_date, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [input.olliixFileId, input.mivaFileId, input.ruleId, input.ruleConfigHash, input.runDate, input.status, input.createdBy],
    );
    return mapRunRow(rows[0]);
  }

  async updateRunStatus(runId: string, status: RunStatus, failureReason?: string): Promise<void> {
    await this.getPool().query("UPDATE runs SET status = $2, failure_reason = $3 WHERE id = $1", [
      runId,
      status,
      failureReason ?? null,
    ]);
  }

  async setRunRuleInfo(runId: string, ruleId: string, ruleConfigHash: string): Promise<void> {
    await this.getPool().query("UPDATE runs SET rule_id = $2, rule_config_hash = $3 WHERE id = $1", [
      runId,
      ruleId,
      ruleConfigHash,
    ]);
  }

  async findRunById(id: string): Promise<RunRecord | null> {
    const { rows } = await this.getPool().query("SELECT * FROM runs WHERE id = $1", [id]);
    if (rows.length === 0) return null;
    return mapRunRow(rows[0]);
  }

  async listRuns(): Promise<RunRecord[]> {
    const { rows } = await this.getPool().query("SELECT * FROM runs ORDER BY created_at DESC LIMIT 50");
    return rows.map(mapRunRow);
  }

  async insertReconciliationRows(runId: string, rows: ReconciliationRow[]): Promise<void> {
    const client = await this.getPool().connect();
    try {
      await client.query("BEGIN");
      for (const r of rows) {
        const { rows: resultRows } = await client.query(
          `INSERT INTO reconciliation_rows
            (run_id, source_row_number, item_no, raw_upc, normalized_upc, description, product_code,
             match_outcome, review_class, warning_codes, blocker_codes, total_qty_raw,
             expected_date, expected_date_sources, current_values, proposed_values, changed, is_eligible_for_approval)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           RETURNING id`,
          [
            runId,
            r.sourceRowNumber,
            r.itemNo,
            r.rawUpc,
            r.normalizedUpc,
            r.description,
            r.productCode,
            r.matchOutcome,
            r.reviewClass,
            r.warningCodes,
            r.blockerCodes,
            r.totalQtyRaw,
            r.expectedDate,
            r.expectedDateSources,
            JSON.stringify(r.current),
            JSON.stringify(r.proposed),
            r.changed,
            r.isEligibleForApproval,
          ],
        );
        const id = resultRows[0].id as string;
        await client.query("INSERT INTO decisions (reconciliation_row_id, run_id, status) VALUES ($1, $2, 'PENDING')", [
          id,
          runId,
        ]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listRunRows(runId: string, filter: RowFilter = {}): Promise<ReviewRowView[]> {
    const clauses: string[] = ["rr.run_id = $1"];
    const params: unknown[] = [runId];

    if (filter.reviewClass && filter.reviewClass.length > 0) {
      params.push(filter.reviewClass);
      clauses.push(`rr.review_class = ANY($${params.length})`);
    }
    if (filter.changed !== undefined) {
      params.push(filter.changed);
      clauses.push(`rr.changed = $${params.length}`);
    }
    if (filter.decisionStatus && filter.decisionStatus.length > 0) {
      params.push(filter.decisionStatus);
      clauses.push(`d.status = ANY($${params.length})`);
    }
    if (filter.matchOutcome && filter.matchOutcome.length > 0) {
      params.push(filter.matchOutcome);
      clauses.push(`rr.match_outcome = ANY($${params.length})`);
    }
    if (filter.search) {
      params.push(`%${filter.search.toLowerCase()}%`);
      clauses.push(
        `(LOWER(COALESCE(rr.item_no, '')) LIKE $${params.length} OR LOWER(COALESCE(rr.product_code, '')) LIKE $${params.length} OR LOWER(COALESCE(rr.raw_upc, '')) LIKE $${params.length})`,
      );
    }

    const { rows } = await this.getPool().query(
      `SELECT rr.*, d.id AS decision_id, d.status AS decision_status, d.warnings_at_decision, d.decided_at, d.batch_id, d.locked
       FROM reconciliation_rows rr
       JOIN decisions d ON d.reconciliation_row_id = rr.id
       WHERE ${clauses.join(" AND ")}
       ORDER BY rr.source_row_number NULLS LAST, rr.product_code`,
      params,
    );

    return rows.map(mapReviewRowView);
  }

  async getRunRow(runId: string, rowId: string): Promise<ReviewRowView | null> {
    const { rows } = await this.getPool().query(
      `SELECT rr.*, d.id AS decision_id, d.status AS decision_status, d.warnings_at_decision, d.decided_at, d.batch_id, d.locked
       FROM reconciliation_rows rr
       JOIN decisions d ON d.reconciliation_row_id = rr.id
       WHERE rr.run_id = $1 AND rr.id = $2`,
      [runId, rowId],
    );
    if (rows.length === 0) return null;
    return mapReviewRowView(rows[0]);
  }

  async getRowsByIds(runId: string, ids: string[]): Promise<ReviewRowView[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.getPool().query(
      `SELECT rr.*, d.id AS decision_id, d.status AS decision_status, d.warnings_at_decision, d.decided_at, d.batch_id, d.locked
       FROM reconciliation_rows rr
       JOIN decisions d ON d.reconciliation_row_id = rr.id
       WHERE rr.run_id = $1 AND rr.id = ANY($2)`,
      [runId, ids],
    );
    return rows.map(mapReviewRowView);
  }

  async setDecision(
    reconciliationRowId: string,
    status: DecisionRecord["status"],
    warningsAtDecision: string[],
    decidedBy: string,
  ): Promise<void> {
    await this.getPool().query(
      `UPDATE decisions
       SET status = $2, warnings_at_decision = $3, decided_by = $4, decided_at = now()
       WHERE reconciliation_row_id = $1 AND locked = false`,
      [reconciliationRowId, status, warningsAtDecision, decidedBy],
    );
  }

  async lockDecisionsForBatch(reconciliationRowIds: string[], batchId: string): Promise<void> {
    if (reconciliationRowIds.length === 0) return;
    await this.getPool().query(`UPDATE decisions SET locked = true, batch_id = $2 WHERE reconciliation_row_id = ANY($1)`, [
      reconciliationRowIds,
      batchId,
    ]);
  }

  async insertBatch(input: InsertBatchInput): Promise<BatchRecord> {
    const { rows } = await this.getPool().query(
      `INSERT INTO batches (run_id, update_file_id, rollback_file_id, exception_file_id, reconciliation_file_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.runId, input.updateFileId, input.rollbackFileId, input.exceptionFileId, input.reconciliationFileId, input.createdBy],
    );
    return mapBatchRow(rows[0]);
  }

  async findBatchById(id: string): Promise<BatchRecord | null> {
    const { rows } = await this.getPool().query("SELECT * FROM batches WHERE id = $1", [id]);
    if (rows.length === 0) return null;
    return mapBatchRow(rows[0]);
  }

  async listBatchesForRun(runId: string): Promise<BatchRecord[]> {
    const { rows } = await this.getPool().query("SELECT * FROM batches WHERE run_id = $1 ORDER BY created_at DESC", [runId]);
    return rows.map(mapBatchRow);
  }

  async listAllBatches(): Promise<BatchRecord[]> {
    const { rows } = await this.getPool().query("SELECT * FROM batches ORDER BY created_at DESC LIMIT 50");
    return rows.map(mapBatchRow);
  }

  async updateBatchImportStatus(batchId: string, status: string): Promise<void> {
    await this.getPool().query("UPDATE batches SET import_status = $2 WHERE id = $1", [batchId, status]);
  }

  async insertLegacyComparison(
    runId: string,
    legacyFileId: string,
    createdBy: string,
    results: LegacyComparisonRowInput[],
  ): Promise<string> {
    const client = await this.getPool().connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "INSERT INTO legacy_comparisons (run_id, legacy_file_id, created_by) VALUES ($1,$2,$3) RETURNING id",
        [runId, legacyFileId, createdBy],
      );
      const comparisonId = rows[0].id as string;
      for (const r of results) {
        await client.query(
          `INSERT INTO legacy_comparison_rows (legacy_comparison_id, source_row_number, product_code, comparison_class, deviation_id, note)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [comparisonId, r.sourceRowNumber, r.productCode, r.comparisonClass, r.deviationId, r.note],
        );
      }
      await client.query("COMMIT");
      return comparisonId;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getLegacyComparisonRows(comparisonId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.getPool().query(
      "SELECT * FROM legacy_comparison_rows WHERE legacy_comparison_id = $1 ORDER BY source_row_number NULLS LAST, product_code",
      [comparisonId],
    );
    return rows;
  }

  async listLegacyComparisonsForRun(runId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.getPool().query(
      "SELECT * FROM legacy_comparisons WHERE run_id = $1 ORDER BY created_at DESC",
      [runId],
    );
    return rows;
  }

  async insertPostImportVerification(
    batchId: string,
    postImportFileId: string,
    createdBy: string,
    results: PostImportVerificationRowInput[],
  ): Promise<string> {
    const client = await this.getPool().connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "INSERT INTO post_import_verifications (batch_id, post_import_file_id, created_by) VALUES ($1,$2,$3) RETURNING id",
        [batchId, postImportFileId, createdBy],
      );
      const verificationId = rows[0].id as string;
      for (const r of results) {
        await client.query(
          "INSERT INTO post_import_verification_rows (verification_id, product_code, result, reason) VALUES ($1,$2,$3,$4)",
          [verificationId, r.productCode, r.result, r.reason],
        );
      }
      const anyFail = results.some((r) => r.result === "FAIL");
      await client.query("UPDATE batches SET import_status = $2 WHERE id = $1", [
        batchId,
        anyFail ? "VERIFICATION_FAILED" : "VERIFIED",
      ]);
      await client.query("COMMIT");
      return verificationId;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getPostImportVerificationRows(verificationId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.getPool().query(
      "SELECT * FROM post_import_verification_rows WHERE verification_id = $1 ORDER BY product_code",
      [verificationId],
    );
    return rows;
  }

  async listPostImportVerificationsForBatch(batchId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.getPool().query(
      "SELECT * FROM post_import_verifications WHERE batch_id = $1 ORDER BY created_at DESC",
      [batchId],
    );
    return rows;
  }

  async insertAuditLog(input: AuditLogInput): Promise<void> {
    await this.getPool().query(
      "INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)",
      [input.actorId, input.action, input.entityType, input.entityId, JSON.stringify(input.details ?? {})],
    );
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
    rowCount: row.row_count === null ? null : Number(row.row_count),
    uploadedAt: (row.uploaded_at as Date).toISOString(),
  };
}

function mapRunRow(row: Record<string, unknown>): RunRecord {
  return {
    id: row.id as string,
    olliixFileId: row.olliix_file_id as string,
    mivaFileId: row.miva_file_id as string,
    ruleId: row.rule_id as string,
    ruleConfigHash: row.rule_config_hash as string,
    runDate: (row.run_date as Date).toISOString().slice(0, 10),
    status: row.status as RunStatus,
    failureReason: (row.failure_reason as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    closedAt: row.closed_at ? (row.closed_at as Date).toISOString() : null,
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
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function mapReviewRowView(row: Record<string, unknown>): ReviewRowView {
  const current = row.current_values as ManagedValues;
  const proposed = row.proposed_values as ManagedValues;
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
    warningCodes: (row.warning_codes as ReconciliationRow["warningCodes"]) ?? [],
    blockerCodes: (row.blocker_codes as ReconciliationRow["blockerCodes"]) ?? [],
    totalQtyRaw: (row.total_qty_raw as string) ?? null,
    expectedDate: (row.expected_date as string) ?? null,
    expectedDateSources: (row.expected_date_sources as WarehouseCode[]) ?? [],
    current,
    proposed,
    changed: row.changed as boolean,
    isEligibleForApproval: row.is_eligible_for_approval as boolean,
  };
  const decision: DecisionRecord = {
    id: row.decision_id as string,
    reconciliationRowId: row.id as string,
    runId: row.run_id as string,
    status: row.decision_status as DecisionRecord["status"],
    warningsAtDecision: (row.warnings_at_decision as string[]) ?? [],
    decidedAt: row.decided_at ? (row.decided_at as Date).toISOString() : null,
    batchId: (row.batch_id as string) ?? null,
    locked: row.locked as boolean,
  };
  return { row: reconRow, decision };
}
