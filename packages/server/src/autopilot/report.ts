import { getRepository, type AutopilotOutcome } from "../db";
import { getResendClient } from "../mail/resendClient";
import type { BrakeResult } from "./brake";

export interface AutopilotReportData {
  outcome: AutopilotOutcome;
  vendorLabel: string | null;
  sender: string | null;
  subject: string | null;
  fileNames: string[];
  runId: string | null;
  /** Plain-language sentences explaining what happened (or what went wrong). */
  notes: string[];
  brake: BrakeResult | null;
  /** Which Miva store the comparison snapshot came from. */
  mivaSite: string | null;
}

function appBaseUrl(): string {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return `http://localhost:${process.env.PORT || 3000}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const HEADLINE: Record<AutopilotOutcome, string> = {
  REVIEWED: "Reviewed, nothing pushed",
  HELD: "Would have been held for a person",
  DUPLICATE: "Already processed",
  REJECTED: "Could not use this email",
  IGNORED: "Ignored",
  FAILED: "Something went wrong",
};

export function renderAutopilotSubject(data: AutopilotReportData): string {
  return `Autopilot: ${HEADLINE[data.outcome]}${data.vendorLabel ? ` (${data.vendorLabel})` : ""}`;
}

function metricLines(brake: BrakeResult): string[] {
  const m = brake.metrics;
  const lines = [`Rows in file: ${m.fileRowCount}${m.previousRowCount !== null ? ` (previous file: ${m.previousRowCount})` : " (no previous file to compare)"}`];
  lines.push(`Products we carry: ${m.carriedCount}`);
  if (m.changedPercent !== null) lines.push(`Would change: ${m.changedPercent}% of carried products`);
  lines.push(`Would be set to No Longer Available: ${m.nlaProposalCount}`);
  if (m.missingOrBlockedPercent !== null) lines.push(`Missing from the file or blocked: ${m.missingOrBlockedPercent}% of carried products`);
  return lines;
}

export function renderAutopilotText(data: AutopilotReportData): string {
  const lines: string[] = [HEADLINE[data.outcome], ""];
  if (data.sender) lines.push(`From: ${data.sender}`);
  if (data.subject) lines.push(`Subject: ${data.subject}`);
  if (data.fileNames.length > 0) lines.push(`Files: ${data.fileNames.join(", ")}`);
  if (data.mivaSite) lines.push(`Compared against the Miva ${data.mivaSite} site`);
  lines.push("", ...data.notes);
  if (data.brake) {
    lines.push("", ...(data.brake.hold ? ["Safety brake would have held this run:", ...data.brake.reasons.map((r) => `- ${r.message}`)] : ["Safety brake: passed."]));
    lines.push("", ...metricLines(data.brake));
  }
  if (data.runId) lines.push("", `Review the run: ${appBaseUrl()}/runs/${data.runId}`);
  lines.push("", "Autopilot is in review-only mode: nothing was sent to Miva.");
  return lines.join("\n");
}

export function renderAutopilotHtml(data: AutopilotReportData): string {
  const p = (s: string) => `<p style="margin:0 0 10px;">${escapeHtml(s)}</p>`;
  const li = (s: string) => `<li>${escapeHtml(s)}</li>`;
  const parts: string[] = [`<h2 style="margin:0 0 12px;font-size:18px;">${escapeHtml(HEADLINE[data.outcome])}</h2>`];
  const meta: string[] = [];
  if (data.sender) meta.push(`From: ${data.sender}`);
  if (data.subject) meta.push(`Subject: ${data.subject}`);
  if (data.fileNames.length > 0) meta.push(`Files: ${data.fileNames.join(", ")}`);
  if (data.mivaSite) meta.push(`Compared against the Miva ${data.mivaSite} site`);
  parts.push(...meta.map(p), ...data.notes.map(p));
  if (data.brake) {
    parts.push(
      data.brake.hold
        ? `<p style="margin:12px 0 4px;"><strong>Safety brake would have held this run:</strong></p><ul>${data.brake.reasons.map((r) => li(r.message)).join("")}</ul>`
        : p("Safety brake: passed."),
    );
    parts.push(`<ul>${metricLines(data.brake).map(li).join("")}</ul>`);
  }
  if (data.runId) {
    parts.push(`<p style="margin:12px 0;"><a href="${escapeHtml(`${appBaseUrl()}/runs/${data.runId}`)}">Review the run</a></p>`);
  }
  parts.push(`<p style="margin:12px 0 0;color:#666;">Autopilot is in review-only mode: nothing was sent to Miva.</p>`);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">${parts.join("")}</div>`;
}

/** Every active admin with a usable address: the report audience until someone asks for something different. */
export async function listAdminRecipients(): Promise<string[]> {
  const users = await getRepository().listUsers();
  return users.filter((u) => u.role === "admin" && u.isActive && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)).map((u) => u.email);
}

/**
 * Emails the report to the admins, and a copy to the sender (who is always an
 * approved address by this point, so this can't be used to bounce mail at a
 * stranger). Never throws: a failed email must not undo or hide a processed message.
 */
export async function sendAutopilotReport(data: AutopilotReportData): Promise<void> {
  try {
    const resend = getResendClient();
    if (!resend) return;
    const to = new Set(await listAdminRecipients());
    if (data.sender && data.outcome !== "IGNORED") to.add(data.sender);
    if (to.size === 0) return;
    await resend.emails.send({
      from: process.env.EMAIL_FROM_ADDRESS || "onboarding@resend.dev",
      to: [...to],
      subject: renderAutopilotSubject(data),
      html: renderAutopilotHtml(data),
      text: renderAutopilotText(data),
    });
  } catch (err) {
    console.error("Failed to send autopilot report email:", err instanceof Error ? err.message : err);
  }
}
