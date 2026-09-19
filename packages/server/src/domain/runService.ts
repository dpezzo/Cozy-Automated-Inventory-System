import { getVendorFileAdapter } from "../vendor/vendorFileRegistry";
import { parseMivaSnapshotCsv } from "../vendor/mivaCsv";
import { readStoredFile, readStoredFileText } from "../storage/fileStorage";
import { ValidationError, ForbiddenError, NotFoundError } from "../errors";
import { getRepository, type RunRecord, type ReviewRowView } from "../db";
import { runReconciliation } from "./runPipeline";
import type { ParsedCalendarDate } from "@cozywinters/shared";

export interface CreateRunInput {
  vendorFileId: string;
  mivaFileId: string;
  runDate: ParsedCalendarDate;
  createdBy: string;
}

export async function createRun(input: CreateRunInput): Promise<RunRecord> {
  const repo = getRepository();
  const vendorFile = await repo.findFileById(input.vendorFileId);
  const mivaFile = await repo.findFileById(input.mivaFileId);
  const vendorAdapter = vendorFile ? getVendorFileAdapter(vendorFile.kind) : undefined;
  if (!vendorFile || !vendorAdapter) {
    throw new ValidationError("FILE_NOT_FOUND", "The selected vendor file was not found.");
  }
  if (!mivaFile || mivaFile.kind !== "miva_snapshot") {
    throw new ValidationError("FILE_NOT_FOUND", "The selected Miva snapshot was not found.");
  }

  const runDateStr = `${input.runDate.year}-${String(input.runDate.month).padStart(2, "0")}-${String(input.runDate.day).padStart(2, "0")}`;
  const run = await repo.insertRun({
    vendorFileId: vendorFile.id,
    mivaFileId: mivaFile.id,
    ruleId: "pending",
    ruleConfigHash: "pending",
    runDate: runDateStr,
    status: "validating",
    createdBy: input.createdBy,
  });

  try {
    await repo.updateRunStatus(run.id, "normalizing");
    const vendorBuffer = readStoredFile(vendorFile.storagePath);
    const { rows: vendorRows } = await vendorAdapter.parse(vendorBuffer);

    const mivaText = readStoredFileText(mivaFile.storagePath);
    const { rows: mivaRows } = parseMivaSnapshotCsv(mivaText);

    await repo.updateRunStatus(run.id, "matching");
    const { rows, ruleId, ruleConfigHash } = runReconciliation({
      vendorKey: vendorAdapter.vendorKey,
      vendorRows,
      mivaRows,
      runDate: input.runDate,
    });

    await repo.updateRunStatus(run.id, "calculating");
    await repo.insertReconciliationRows(run.id, rows);

    await repo.setRunRuleInfo(run.id, ruleId, ruleConfigHash);
    await repo.updateRunStatus(run.id, "ready");
    await repo.insertAuditLog({
      actorId: input.createdBy,
      action: "RUN_CREATED",
      entityType: "run",
      entityId: run.id,
      details: { rowCount: rows.length, ruleId, ruleConfigHash },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown failure during reconciliation.";
    await repo.updateRunStatus(run.id, "failed", message);
    await repo.insertAuditLog({
      actorId: input.createdBy,
      action: "RUN_FAILED",
      entityType: "run",
      entityId: run.id,
      details: { message },
    });
    throw err;
  }

  const finalRun = await repo.findRunById(run.id);
  return finalRun!;
}

export interface RunSummary {
  total: number;
  byReviewClass: Record<string, number>;
  byDecisionStatus: Record<string, number>;
  changed: number;
  unchanged: number;
}

export async function getRunSummary(runId: string): Promise<RunSummary> {
  const rows = await getRepository().listRunRows(runId);
  const byReviewClass: Record<string, number> = {};
  const byDecisionStatus: Record<string, number> = {};
  let changed = 0;
  for (const { row, decision } of rows) {
    byReviewClass[row.reviewClass] = (byReviewClass[row.reviewClass] ?? 0) + 1;
    byDecisionStatus[decision.status] = (byDecisionStatus[decision.status] ?? 0) + 1;
    if (row.changed) changed++;
  }
  return { total: rows.length, byReviewClass, byDecisionStatus, changed, unchanged: rows.length - changed };
}

/** Approve-all-clean: only eligible, changed, CLEAN, unlocked rows. Never touches warnings or blocked rows. */
export async function approveAllClean(runId: string, userId: string): Promise<number> {
  const repo = getRepository();
  const rows = await repo.listRunRows(runId, { reviewClass: ["CLEAN"], changed: true });
  const eligible = rows.filter((r) => r.row.isEligibleForApproval && !r.decision.locked);
  for (const r of eligible) {
    await repo.setDecision(r.row.id, "APPROVED", r.row.warningCodes, userId);
  }
  await repo.insertAuditLog({
    actorId: userId,
    action: "APPROVE_ALL_CLEAN",
    entityType: "run",
    entityId: runId,
    details: { count: eligible.length },
  });
  return eligible.length;
}

export type DecisionInput = "APPROVED" | "APPROVED_WARNING_ACK" | "REJECTED" | "PENDING";

/**
 * Sets a single row's decision, enforcing MVP approval-eligibility rules:
 * blocked and unchanged rows can never be approved, and warning rows require
 * the explicit APPROVED_WARNING_ACK decision (individual acknowledgement).
 */
export async function setRowDecision(
  runId: string,
  rowId: string,
  decision: DecisionInput,
  userId: string,
): Promise<void> {
  const repo = getRepository();
  const view = await repo.getRunRow(runId, rowId);
  if (!view) throw new NotFoundError("Reconciliation row not found.");
  if (view.decision.locked) {
    throw new ForbiddenError("This row's decision is frozen in a generated batch and cannot be changed.");
  }

  if (decision === "PENDING" || decision === "REJECTED") {
    await repo.setDecision(rowId, decision, view.row.warningCodes, userId);
    return;
  }

  if (view.row.reviewClass === "BLOCKED" || view.row.reviewClass === "UNCHANGED") {
    throw new ForbiddenError(`A ${view.row.reviewClass.toLowerCase()} row can never be approved.`);
  }

  if (view.row.reviewClass === "WARNING" && decision !== "APPROVED_WARNING_ACK") {
    throw new ForbiddenError("Warning rows require explicit warning acknowledgement (APPROVED_WARNING_ACK).");
  }
  if (view.row.reviewClass === "CLEAN" && decision === "APPROVED_WARNING_ACK") {
    throw new ForbiddenError("A clean row has no warnings to acknowledge; use APPROVED.");
  }

  await repo.setDecision(rowId, decision, view.row.warningCodes, userId);
}

export async function bulkDecision(
  runId: string,
  rowIds: string[],
  decision: "APPROVED" | "REJECTED",
  userId: string,
): Promise<{ applied: number; skipped: string[] }> {
  const repo = getRepository();
  const views = await repo.getRowsByIds(runId, rowIds);
  let applied = 0;
  const skipped: string[] = [];
  for (const v of views) {
    if (v.decision.locked || v.row.reviewClass !== "CLEAN" || !v.row.isEligibleForApproval) {
      skipped.push(v.row.id);
      continue;
    }
    await repo.setDecision(v.row.id, decision, v.row.warningCodes, userId);
    applied++;
  }
  return { applied, skipped };
}

export async function getBatchableRows(runId: string): Promise<ReviewRowView[]> {
  const repo = getRepository();
  const approved = await repo.listRunRows(runId, { decisionStatus: ["APPROVED", "APPROVED_WARNING_ACK"], changed: true });
  return approved.filter((v) => !v.decision.locked && (v.row.reviewClass === "CLEAN" || v.row.reviewClass === "WARNING"));
}
