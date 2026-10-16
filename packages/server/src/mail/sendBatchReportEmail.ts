import { getRepository } from "../db";
import { getRunSummary, getWarningCodeBreakdown } from "../domain/runService";
import { vendorSlugFromRuleId } from "../domain/batchService";
import type { MivaPushTarget, PushBatchResult } from "../miva/mivaApiPush"; // type-only: avoids a runtime import cycle with mivaApiPush.ts, which imports sendBatchReportEmail itself.
import { getResendClient } from "./resendClient";
import {
  renderBatchReportHtml,
  renderBatchReportSubject,
  renderBatchReportText,
  type BatchPushAction,
  type BatchReportEmailData,
} from "./batchReportTemplate";

const MAX_FAILED_SAMPLES_FETCHED = 10;

function appBaseUrl(): string {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return `http://localhost:${process.env.PORT || 3000}`;
}

async function buildBatchReportData(params: {
  batchId: string;
  target: MivaPushTarget;
  action: BatchPushAction;
  pushResult: PushBatchResult;
}): Promise<BatchReportEmailData | null> {
  const repo = getRepository();
  const batch = await repo.findBatchById(params.batchId);
  if (!batch) return null;
  const run = await repo.findRunById(batch.runId);
  if (!run) return null;

  const [runSummary, warningBreakdown, activeSite, vendorConfig] = await Promise.all([
    getRunSummary(run.id),
    getWarningCodeBreakdown(run.id),
    repo.getMivaActiveSite(),
    repo.findVendorConfigByKey(vendorSlugFromRuleId(run.ruleId)),
  ]);

  // byDecisionStatus buckets are mutually exclusive and sum to runSummary.total,
  // so "not approved" is the only safe way to count skipped rows. The earlier
  // byReviewClass.BLOCKED + byDecisionStatus.PENDING formula double-counted:
  // a BLOCKED row is always PENDING (can never be approved), and an UNCHANGED
  // row left undecided is also PENDING, so both got counted in *both* terms --
  // the reported total could exceed runSummary.total entirely.
  const skippedCount =
    runSummary.total - (runSummary.byDecisionStatus.APPROVED ?? 0) - (runSummary.byDecisionStatus.APPROVED_WARNING_ACK ?? 0);

  return {
    target: params.target,
    action: params.action,
    activeSite,
    batchId: batch.id,
    runId: run.id,
    runDate: run.runDate,
    vendorLabel: vendorConfig?.vendorLabel ?? vendorSlugFromRuleId(run.ruleId),
    appBaseUrl: appBaseUrl(),
    pushed: params.pushResult.pushed,
    failed: params.pushResult.failed,
    verificationMismatches: params.pushResult.verificationMismatches,
    unattempted: Math.max(0, params.pushResult.results.length - params.pushResult.pushed - params.pushResult.failed),
    runSummary: {
      total: runSummary.total,
      byReviewClass: runSummary.byReviewClass,
      changed: runSummary.changed,
      unchanged: runSummary.unchanged,
    },
    warningBreakdown,
    skippedCount,
    failedRowSamples: params.pushResult.results
      .filter((r) => !r.success)
      .slice(0, MAX_FAILED_SAMPLES_FETCHED)
      .map((r) => ({ productCode: r.productCode, errorMessage: r.errorMessage ?? r.errorCode ?? "Unknown error." })),
  };
}

/**
 * Sends the HTML summary email for a completed batch push/rollback, for
 * every outcome (success, partial failure, full failure) and both targets.
 * Never throws -- a failed or unconfigured/disabled email report must not
 * affect pushBatchToMiva()'s own return value or error, so every failure
 * mode here is caught and logged instead of propagated.
 */
export async function sendBatchReportEmail(params: {
  batchId: string;
  target: MivaPushTarget;
  action: BatchPushAction;
  pushResult: PushBatchResult;
}): Promise<void> {
  try {
    const resend = getResendClient();
    if (!resend) return;

    const repo = getRepository();
    const enabled = await repo.getReportEnabled();
    if (!enabled) return;

    const data = await buildBatchReportData(params);
    if (!data) return;

    const to = await repo.getReportRecipientEmail();
    await resend.emails.send({
      from: process.env.EMAIL_FROM_ADDRESS || "onboarding@resend.dev",
      to,
      subject: renderBatchReportSubject(data),
      html: renderBatchReportHtml(data),
      text: renderBatchReportText(data),
    });
  } catch (err) {
    console.error("Failed to send batch report email:", err instanceof Error ? err.message : err);
  }
}
