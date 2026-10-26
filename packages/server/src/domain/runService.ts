import { getVendorFileAdapter, getDynamicVendorFileAdapter } from "../vendor/vendorFileRegistry";
import { parseMivaSnapshotCsv } from "../vendor/mivaCsv";
import { readStoredFile, readStoredFileText, storedFileExists } from "../storage/fileStorage";
import { ValidationError, ForbiddenError, NotFoundError } from "../errors";
import { getRepository, type RunRecord, type ReviewRowView, type RowFilter, type ReconciliationRowRecord, type DecisionRecord } from "../db";
import { runReconciliation } from "./runPipeline";
import { vendorSlugFromRuleId } from "./batchService";
import { isBrandAllowed, DS_INV_MGT_HIDDEN, type ParsedCalendarDate, type WarningCode } from "@cozywinters/shared";

export interface CreateRunInput {
  vendorFileId: string;
  mivaFileId: string;
  runDate: ParsedCalendarDate;
  createdBy: string;
  /** Bypasses the duplicate-run guard below -- set when the caller has already been warned and wants to proceed anyway (e.g. intentionally re-testing the same file pair after a config change). */
  confirmDuplicate?: boolean;
}

export async function createRun(input: CreateRunInput): Promise<RunRecord> {
  const repo = getRepository();
  const vendorFile = await repo.findFileById(input.vendorFileId);
  const mivaFile = await repo.findFileById(input.mivaFileId);
  const vendorAdapter = vendorFile
    ? vendorFile.kind === "vendor_dynamic" && vendorFile.vendorKey
      ? await getDynamicVendorFileAdapter(vendorFile.vendorKey)
      : getVendorFileAdapter(vendorFile.kind)
    : undefined;
  if (!vendorFile || !vendorAdapter) {
    throw new ValidationError("FILE_NOT_FOUND", "The selected vendor file was not found.");
  }
  if (!mivaFile || mivaFile.kind !== "miva_snapshot") {
    throw new ValidationError("FILE_NOT_FOUND", "The selected Miva snapshot was not found.");
  }

  // Guard against an accidental double-click or retried request silently
  // creating two independent, both-approvable runs for the same file pair.
  // A prior run that failed doesn't block a fresh attempt. This is a warning,
  // not a hard rule -- intentionally re-running the same file pair (e.g. to
  // compare output after a vendor config change) is legitimate, so the
  // caller can bypass it with confirmDuplicate once they've seen the warning.
  if (!input.confirmDuplicate) {
    const existingRuns = await repo.listRuns();
    const duplicate = existingRuns.find(
      (r) => r.vendorFileId === vendorFile.id && r.mivaFileId === mivaFile.id && r.status !== "failed",
    );
    if (duplicate) {
      throw new ValidationError(
        "DUPLICATE_RUN",
        "A run already exists for this vendor file and Miva snapshot pair.",
        { existingRunId: duplicate.id },
      );
    }
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
    if (!storedFileExists(vendorFile.storagePath) || !storedFileExists(mivaFile.storagePath)) {
      throw new ValidationError(
        "FILE_CONTENT_MISSING",
        "One of the selected files' content is no longer available in storage (it may predate a server restart) -- re-upload it and try again.",
      );
    }
    const vendorBuffer = readStoredFile(vendorFile.storagePath);
    const { rows: vendorRows } = await vendorAdapter.parse(vendorBuffer);

    const mivaText = readStoredFileText(mivaFile.storagePath);
    // The full catalog (8,000+ SKUs) is passed through unfiltered -- DS_INV_MGT
    // is blank for most of it, but reconcile() itself now decides what to do
    // with that: a blank/NLA row that's genuinely matched by a vendor's file
    // surfaces as a WARNING (see reconcile.ts) instead of being silently
    // dropped before matching, and pass-2's "missing from vendor" scan still
    // excludes blank-flagged rows so untracked products don't flood in as
    // fake missing rows.
    const { rows: mivaRows } = parseMivaSnapshotCsv(mivaText);

    await repo.updateRunStatus(run.id, "matching");
    const { rows, ruleId, ruleConfigHash } = await runReconciliation({
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
  /** Keyed by MatchOutcome (MATCHED, MISSING - REVIEW REQUIRED, BLOCKED IDENTIFIER, etc.) -- a genuinely distinct dimension from reviewClass: e.g. a Miva-only orphan row (not in the vendor file) is MISSING - REVIEW REQUIRED regardless of whether it's CLEAN/BLOCKED/UNCHANGED. */
  byMatchOutcome: Record<string, number>;
  changed: number;
  unchanged: number;
  /** Every Miva catalog row under this vendor's brand(s), regardless of tracked flag/active status -- a denominator independent of reconciliation_rows, which only ever reflects what actually got matched/missing this run. Null when the Miva snapshot file is no longer available on disk (predates a server restart). */
  mivaBrandTotal: number | null;
}

export async function getRunSummary(runId: string): Promise<RunSummary> {
  const repo = getRepository();
  const rows = await repo.listRunRows(runId);
  const byReviewClass: Record<string, number> = {};
  const byDecisionStatus: Record<string, number> = {};
  const byMatchOutcome: Record<string, number> = {};
  let changed = 0;
  for (const { row, decision } of rows) {
    byReviewClass[row.reviewClass] = (byReviewClass[row.reviewClass] ?? 0) + 1;
    byDecisionStatus[decision.status] = (byDecisionStatus[decision.status] ?? 0) + 1;
    byMatchOutcome[row.matchOutcome] = (byMatchOutcome[row.matchOutcome] ?? 0) + 1;
    if (row.changed) changed++;
  }

  const mivaBrandTotal = await computeMivaBrandTotal(runId);

  return {
    total: rows.length,
    byReviewClass,
    byDecisionStatus,
    byMatchOutcome,
    changed,
    unchanged: rows.length - changed,
    mivaBrandTotal,
  };
}

/** Per-warning-code counts across a run's rows, sorted most-common first -- used by the batch push/rollback email report. Pure in-memory tally over the same rows getRunSummary() already loads, so it needs no dedicated query. */
export async function getWarningCodeBreakdown(runId: string): Promise<{ code: string; count: number }[]> {
  const repo = getRepository();
  const rows = await repo.listRunRows(runId);
  const counts: Record<string, number> = {};
  for (const { row } of rows) {
    for (const code of row.warningCodes) counts[code] = (counts[code] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);
}

/** Re-reads the run's stored Miva snapshot (not reconciliation_rows, which only ever holds what this run actually matched/missed) and counts every row under the vendor's brand allowlist, independent of DS_INV_MGT. Returns null rather than throwing when the snapshot file or vendor config is no longer available, so a stat tile can't take down the whole summary. */
async function computeMivaBrandTotal(runId: string): Promise<number | null> {
  const repo = getRepository();
  const run = await repo.findRunById(runId);
  if (!run) return null;
  const mivaFile = await repo.findFileById(run.mivaFileId);
  if (!mivaFile || !storedFileExists(mivaFile.storagePath)) return null;
  const vendorConfig = await repo.findVendorConfigByKey(vendorSlugFromRuleId(run.ruleId));
  if (!vendorConfig) return null;

  const { rows: mivaRows } = parseMivaSnapshotCsv(readStoredFileText(mivaFile.storagePath));
  return mivaRows.filter((r) => isBrandAllowed(r.brandRaw, vendorConfig.brandAllowlist) && r.currentDsInvMgt.trim() !== DS_INV_MGT_HIDDEN).length;
}

function rowMatchesFilter(row: ReconciliationRowRecord, decisionStatus: string, filter: RowFilter): boolean {
  if (filter.reviewClass && filter.reviewClass.length > 0 && !filter.reviewClass.includes(row.reviewClass)) return false;
  if (filter.changed !== undefined && row.changed !== filter.changed) return false;
  if (filter.decisionStatus && filter.decisionStatus.length > 0 && !filter.decisionStatus.includes(decisionStatus)) return false;
  if (filter.matchOutcome && filter.matchOutcome.length > 0 && !filter.matchOutcome.includes(row.matchOutcome)) return false;
  if (filter.search) {
    const term = filter.search.toLowerCase();
    const haystack = [row.itemNo, row.productCode, row.rawUpc].map((v) => (v ?? "").toLowerCase());
    if (!haystack.some((v) => v.includes(term))) return false;
  }
  return true;
}

/**
 * Synthesizes (never persists) one informational row per brand-eligible
 * Miva product this run's reconciliation_rows has nothing to say about --
 * neither matched nor already flagged "missing" -- almost always because
 * its DROPSHIP_INVENTORY_MANAGEMENT flag is blank, the same population
 * pass 2 (reconcile.ts) deliberately excludes from the real "missing from
 * vendor" scan to avoid flooding it. Backs Run Review's "Show all Miva
 * products" toggle: purely a browsing aid, deliberately kept separate from
 * the still-undecided question of whether these should ever become real,
 * actionable reconciliation_rows (see CHANGELOG 2026-10-13 and project
 * notes -- parked pending a live walkthrough). Always UNCHANGED/never
 * eligible for approval, so there's no path for one to end up in a batch.
 */
export async function listUntrackedBrandRows(runId: string, filter: RowFilter = {}): Promise<ReviewRowView[]> {
  const repo = getRepository();
  const run = await repo.findRunById(runId);
  if (!run) return [];
  const mivaFile = await repo.findFileById(run.mivaFileId);
  if (!mivaFile || !storedFileExists(mivaFile.storagePath)) return [];
  const vendorConfig = await repo.findVendorConfigByKey(vendorSlugFromRuleId(run.ruleId));
  if (!vendorConfig) return [];

  // Only MATCHED/MISSING rows count as "already shown" -- a product whose
  // only row is e.g. BLOCKED DUPLICATE VENDOR KEY (the vendor's own file
  // reuses that identifier elsewhere, unrelated to this product itself)
  // still needs its own synthetic row here, or it's invisible to the "show
  // all Miva products" view entirely despite genuinely being one of this
  // brand's products. A row's productCode is pipe-joined (see reconcile.ts's
  // joinCodes) when it resolved ambiguously -- e.g. two Miva products
  // sharing one GTIN -- so splitting on "|" is required too.
  const existingRows = await repo.listRunRows(runId);
  const coveredProductCodes = new Set(
    existingRows
      .filter((v) => v.row.matchOutcome === "MATCHED" || v.row.matchOutcome === "MISSING - REVIEW REQUIRED")
      .flatMap((v) => (v.row.productCode ? v.row.productCode.split("|") : [])),
  );

  const { rows: mivaRows } = parseMivaSnapshotCsv(readStoredFileText(mivaFile.storagePath));
  const results: ReviewRowView[] = [];
  for (const mivaRow of mivaRows) {
    if (!isBrandAllowed(mivaRow.brandRaw, vendorConfig.brandAllowlist)) continue;
    if (mivaRow.currentDsInvMgt.trim() === DS_INV_MGT_HIDDEN) continue; // set to "3": hidden from the app entirely
    if (coveredProductCodes.has(mivaRow.productCode)) continue;
    coveredProductCodes.add(mivaRow.productCode); // defensive: never emit two synthetic rows for the same product_code

    const current = {
      simpleInventory: mivaRow.currentSimpleInventory,
      availability: mivaRow.currentAvailability,
      restockMessage: mivaRow.currentRestockMessage,
      dataFeed: mivaRow.currentDataFeed,
      shoppingFeed: mivaRow.currentShoppingFeed,
      dsInvMgt: mivaRow.currentDsInvMgt,
    };
    const row: ReconciliationRowRecord = {
      id: `untracked:${runId}:${mivaRow.productCode}`,
      runId,
      sourceRowNumber: null,
      itemNo: null,
      rawUpc: mivaRow.gtinRaw ?? mivaRow.mpnRaw,
      normalizedUpc: null,
      description: null,
      productCode: mivaRow.productCode,
      matchOutcome: "IN MIVA - NOT TRACKED",
      reviewClass: "UNCHANGED",
      warningCodes: [],
      blockerCodes: [],
      totalQtyRaw: null,
      expectedDate: null,
      expectedDateSources: [],
      current,
      proposed: current,
      changed: false,
      isEligibleForApproval: false,
    };
    const decision: DecisionRecord = {
      id: `untracked-decision:${runId}:${mivaRow.productCode}`,
      reconciliationRowId: row.id,
      runId,
      status: "PENDING",
      warningsAtDecision: [],
      decidedAt: null,
      batchId: null,
      locked: false,
    };
    if (!rowMatchesFilter(row, decision.status, filter)) continue;
    results.push({ row, decision });
  }
  return results;
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

/**
 * Approve-all-single-warning: only eligible, changed, WARNING, unlocked rows
 * whose warningCodes is EXACTLY [warningCode] -- a row with this warning
 * mixed with another (e.g. WAREHOUSE_TOTAL_MISMATCH) is excluded and still
 * requires individual review. Used for the "Approve all (blank
 * tracked-flag only)" bulk action so a one-time backlog of
 * MIVA_NOT_DROPSHIP_TRACKED rows doesn't require clicking through each one
 * by hand, while anything more ambiguous still does.
 */
export async function approveAllSingleWarning(runId: string, warningCode: WarningCode, userId: string): Promise<number> {
  const repo = getRepository();
  const rows = await repo.listRunRows(runId, { reviewClass: ["WARNING"], changed: true });
  const eligible = rows.filter(
    (r) => r.row.isEligibleForApproval && !r.decision.locked && r.row.warningCodes.length === 1 && r.row.warningCodes[0] === warningCode,
  );
  for (const r of eligible) {
    await repo.setDecision(r.row.id, "APPROVED_WARNING_ACK", r.row.warningCodes, userId);
  }
  await repo.insertAuditLog({
    actorId: userId,
    action: "APPROVE_ALL_WARNING",
    entityType: "run",
    entityId: runId,
    details: { count: eligible.length, warningCode },
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
