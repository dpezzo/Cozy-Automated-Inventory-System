import type { MivaPushTarget } from "../miva/mivaApiPush"; // type-only, no runtime dependency on mivaApiPush.ts

export type BatchPushAction = "API_PUSH_SUCCEEDED" | "API_PUSH_FAILED" | "API_PUSH_PARTIAL_FAILURE";

export interface BatchReportEmailData {
  target: MivaPushTarget;
  action: BatchPushAction;
  /** Which Miva site the push actually ran against -- display only, never gates whether the email sends. */
  activeSite: "development" | "live";
  batchId: string;
  runId: string;
  runDate: string;
  vendorLabel: string;
  /** No trailing slash. */
  appBaseUrl: string;
  pushed: number;
  failed: number;
  verificationMismatches: number;
  unattempted: number;
  runSummary: {
    total: number;
    byReviewClass: Record<string, number>;
    changed: number;
    unchanged: number;
  };
  warningBreakdown: { code: string; count: number }[];
  skippedCount: number;
  failedRowSamples: { productCode: string; errorMessage: string }[];
}

const MAX_LIST_ITEMS = 5;
const MAX_FAILED_SAMPLES = 10;

// Literal hex values, not CSS variables -- email clients don't support
// custom properties, so this is a one-time port of packages/web/src/styles.css's
// light theme palette into a form the template can use directly.
const COLOR = {
  bg: "#f7f5f2",
  panel: "#ffffff",
  panel2: "#f4f1ec",
  border: "#e2ddd3",
  text: "#262220",
  muted: "#6b6560",
  brand: "#9d1c20",
  brandHover: "#7f1519",
  // Matches the app's own two-button-color convention for sequential/distinct
  // actions (Run Review's "Approve all clean" = brand red, "Generate batch" =
  // charcoal) -- reused here so "View Run" and "View Batch" read as visually
  // distinct, not duplicate, actions.
  charcoal: "#333333",
  green: "#16a34a",
  greenSoft: "#dcfce7",
  amber: "#b45309",
  amberSoft: "#fef3c7",
  red: "#b3261e",
  redSoft: "#fde2e1",
  // Deliberately NOT reused from the amber/red status palette above -- the
  // Live-site banner needs to read as categorically different from any
  // row-level warning/failure color in the same email, so a glance at the
  // banner alone (regardless of success/failure) tells you which store it hit.
  liveBanner: "#16a34a",
  devBanner: "#dc2626",
} as const;

const FONT_STACK = "'Inter', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function isSuccess(data: BatchReportEmailData): boolean {
  return data.action === "API_PUSH_SUCCEEDED";
}

function isPartial(data: BatchReportEmailData): boolean {
  return data.action === "API_PUSH_PARTIAL_FAILURE";
}

function siteLabel(data: BatchReportEmailData): string {
  return data.activeSite === "live" ? "Live" : "Development";
}

export function renderBatchReportSubject(data: BatchReportEmailData): string {
  const verb = data.target === "rollback" ? "Rollback" : "Batch push";
  const outcome = isSuccess(data) ? `${verb} succeeded` : isPartial(data) ? `⚠ ${verb} partially failed` : `⚠ ${verb} failed`;
  // Live gets a shout-prefix instead of a trailing parenthetical -- inbox
  // list views often truncate the end of a subject line, so the one piece
  // of information that must never be missed (this hit the real store) goes
  // first. Development stays a quieter trailing tag, matching the original
  // framing, since there's nothing urgent to flag about it.
  if (data.activeSite === "live") return `\u{1F534} LIVE -- ${outcome} -- ${data.vendorLabel}`;
  return `${outcome} -- ${data.vendorLabel} (Development)`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statTile(label: string, value: string | number, color: string = COLOR.text): string {
  return `
    <td style="padding:4px;" valign="top">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.panel};border:1px solid ${COLOR.border};border-radius:10px;">
        <tr>
          <td style="padding:14px 12px;text-align:center;">
            <div style="font-size:22px;font-weight:700;color:${color};font-family:${FONT_STACK};">${escapeHtml(String(value))}</div>
            <div style="font-size:12px;color:${COLOR.muted};font-family:${FONT_STACK};margin-top:2px;">${escapeHtml(label)}</div>
          </td>
        </tr>
      </table>
    </td>`;
}

/** `linkHref`, when given, adds a small "View these rows" text link right-aligned on the same row as the pill. */
function sectionHeader(label: string, count: number, bg: string, fg: string, linkHref?: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
      <tr>
        <td>
          <span style="display:inline-block;background:${bg};color:${fg};font-family:${FONT_STACK};font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;">
            ${escapeHtml(label)} &middot; ${count}
          </span>
        </td>
        ${
          linkHref
            ? `<td style="text-align:right;">
                <a href="${escapeHtml(linkHref)}" style="font-family:${FONT_STACK};font-size:12px;color:${COLOR.brand};text-decoration:none;font-weight:600;">
                  View these rows &rarr;
                </a>
              </td>`
            : ""
        }
      </tr>
    </table>`;
}

/** A full-width, impossible-to-miss color strip naming the Miva site this push/rollback hit -- deliberately separate from the (success/failure-colored) header band above it, so which store it was stays legible no matter the outcome color. */
function siteBanner(data: BatchReportEmailData): string {
  const live = data.activeSite === "live";
  const bg = live ? COLOR.liveBanner : COLOR.devBanner;
  const label = live
    ? "⚠ LIVE STORE -- this affects the real, customer-facing site"
    : "DEVELOPMENT STORE -- test site, not customer-facing";
  return `
    <tr>
      <td style="background:${bg};padding:10px 28px;text-align:center;">
        <span style="font-family:${FONT_STACK};color:#ffffff;font-size:13px;font-weight:800;letter-spacing:0.02em;">
          ${escapeHtml(label)}
        </span>
      </td>
    </tr>`;
}

function cappedList(items: string[], cap: number): string {
  if (items.length === 0) return `<p style="font-size:13px;color:${COLOR.muted};font-family:${FONT_STACK};margin:6px 0 0;">None.</p>`;
  const shown = items.slice(0, cap);
  const remaining = items.length - shown.length;
  const listItems = shown.map((item) => `<li style="margin:2px 0;">${item}</li>`).join("");
  const more = remaining > 0 ? `<li style="margin:2px 0;color:${COLOR.muted};">+${remaining} more</li>` : "";
  return `<ul style="font-size:13px;color:${COLOR.text};font-family:${FONT_STACK};margin:6px 0 0;padding-left:18px;">${listItems}${more}</ul>`;
}

function warningBreakdownTable(data: BatchReportEmailData): string {
  if (data.warningBreakdown.length === 0) return "";
  const rows = data.warningBreakdown
    .map(
      (w) => `
      <tr>
        <td style="padding:6px 8px;font-size:13px;color:${COLOR.text};font-family:${FONT_STACK};border-top:1px solid ${COLOR.border};">${escapeHtml(w.code)}</td>
        <td style="padding:6px 8px;font-size:13px;color:${COLOR.muted};font-family:${FONT_STACK};border-top:1px solid ${COLOR.border};text-align:right;">${w.count}</td>
      </tr>`,
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;background:${COLOR.panel};border:1px solid ${COLOR.border};border-radius:10px;overflow:hidden;">
      ${rows}
    </table>`;
}

function ctaButton(label: string, href: string, bg: string): string {
  return `
    <td style="padding:6px 8px 0 0;">
      <a href="${escapeHtml(href)}" style="display:inline-block;background:${bg};color:#ffffff;font-family:${FONT_STACK};font-size:14px;font-weight:600;text-decoration:none;padding:10px 20px;border-radius:6px;">
        ${escapeHtml(label)}
      </a>
    </td>`;
}

export function renderBatchReportHtml(data: BatchReportEmailData): string {
  const runLink = `${data.appBaseUrl}/runs/${data.runId}`;
  const batchLink = `${data.appBaseUrl}/batches/${data.batchId}`;
  // Run Review (RunReviewPage.tsx) reads `reviewClass`/`decisionStatus` query
  // params once on first render to seed its filter checkboxes -- see
  // filterFromQueryParam() there. "Updated" and "Skipped" aren't reviewClass
  // values themselves, so they're approximated via decisionStatus: an
  // approved row is exactly what a generated batch locks in and pushes, and
  // "skipped" is everything that isn't (PENDING or REJECTED), matching how
  // skippedCount itself is computed in sendBatchReportEmail.ts.
  const cleanLink = `${runLink}?reviewClass=CLEAN`;
  const updatedLink = `${runLink}?reviewClass=CLEAN,WARNING&decisionStatus=APPROVED`;
  const warningLink = `${runLink}?reviewClass=WARNING`;
  const skippedLink = `${runLink}?reviewClass=CLEAN,WARNING,BLOCKED,UNCHANGED&decisionStatus=PENDING,REJECTED`;

  const headerColor = isSuccess(data) ? COLOR.brand : isPartial(data) ? COLOR.amber : COLOR.red;
  const headline = isSuccess(data)
    ? `${data.target === "rollback" ? "Rollback" : "Batch push"} completed successfully`
    : isPartial(data)
      ? `${data.target === "rollback" ? "Rollback" : "Batch push"} partially failed`
      : `${data.target === "rollback" ? "Rollback" : "Batch push"} failed`;

  const cleanCount = data.runSummary.byReviewClass.CLEAN ?? 0;
  const warningCount = data.runSummary.byReviewClass.WARNING ?? 0;

  const failedSampleItems = data.failedRowSamples.map((r) => `${escapeHtml(r.productCode)} -- ${escapeHtml(r.errorMessage)}`);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(renderBatchReportSubject(data))}</title>
  </head>
  <body style="margin:0;padding:0;background:${COLOR.bg};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.bg};padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${COLOR.panel};border-radius:14px;overflow:hidden;border:1px solid ${COLOR.border};">
            <tr>
              <td style="background:${headerColor};padding:24px 28px;">
                <div style="font-family:${FONT_STACK};color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;opacity:0.85;">
                  CozyWinters Automated Inventory System
                </div>
                <div style="font-family:${FONT_STACK};color:#ffffff;font-size:20px;font-weight:700;margin-top:6px;">
                  ${escapeHtml(headline)}
                </div>
                <div style="font-family:${FONT_STACK};color:#ffffff;font-size:13px;margin-top:4px;opacity:0.9;">
                  ${escapeHtml(data.vendorLabel)} &middot; Run ${escapeHtml(data.runDate)} &middot; Pushed to: ${escapeHtml(siteLabel(data))}
                </div>
              </td>
            </tr>
            ${siteBanner(data)}
            <tr>
              <td style="padding:20px 28px 4px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    ${statTile("Total rows", data.runSummary.total)}
                    ${statTile(data.target === "rollback" ? "Rolled back" : "Pushed", data.pushed, COLOR.green)}
                    ${statTile("Failed", data.failed, data.failed > 0 ? COLOR.red : COLOR.text)}
                    ${statTile("Verify mismatches", data.verificationMismatches, data.verificationMismatches > 0 ? COLOR.amber : COLOR.text)}
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 8px;">
                ${sectionHeader("Clean", cleanCount, COLOR.greenSoft, COLOR.green, cleanLink)}
                <p style="font-size:13px;color:${COLOR.muted};font-family:${FONT_STACK};margin:6px 0 0;">
                  ${cleanCount} row(s) classified clean this run.
                </p>

                ${sectionHeader("Updated", data.pushed, COLOR.greenSoft, COLOR.green, updatedLink)}
                <p style="font-size:13px;color:${COLOR.muted};font-family:${FONT_STACK};margin:6px 0 0;">
                  ${data.pushed} row(s) ${data.target === "rollback" ? "rolled back" : "applied"} to the ${escapeHtml(siteLabel(data))} site.
                </p>

                ${sectionHeader("Warning", warningCount, COLOR.amberSoft, COLOR.amber, warningLink)}
                ${warningBreakdownTable(data)}

                ${sectionHeader("Skipped", data.skippedCount, COLOR.panel2, COLOR.muted, skippedLink)}
                ${cappedList([`${data.skippedCount} row(s) blocked or left undecided this run -- not included in this batch.`], 1)}

                ${
                  data.failed > 0 || data.unattempted > 0
                    ? `${sectionHeader("Failed", data.failed + data.unattempted, COLOR.redSoft, COLOR.red)}${cappedList(failedSampleItems, MAX_LIST_ITEMS)}${
                        data.unattempted > 0
                          ? `<p style="font-size:13px;color:${COLOR.muted};font-family:${FONT_STACK};margin:6px 0 0;">${data.unattempted} additional row(s) were never attempted after an earlier chunk failed.</p>`
                          : ""
                      }`
                    : ""
                }
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    ${ctaButton("View Run", runLink, COLOR.charcoal)}
                    ${ctaButton("View Batch", batchLink, COLOR.brand)}
                  </tr>
                </table>
                <p style="font-size:12px;color:${COLOR.muted};font-family:${FONT_STACK};margin:10px 0 0;">
                  Open the batch to push again or roll it back if needed.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;border-top:1px solid ${COLOR.border};">
                <p style="font-size:12px;color:${COLOR.muted};font-family:${FONT_STACK};margin:0;">
                  This is an automated report from the CozyWinters Automated Inventory System.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderBatchReportText(data: BatchReportEmailData): string {
  const runLink = `${data.appBaseUrl}/runs/${data.runId}`;
  const live = data.activeSite === "live";
  const lines = [
    renderBatchReportSubject(data),
    "",
    live
      ? "*** LIVE STORE -- this affects the real, customer-facing site ***"
      : "Development store -- test site, not customer-facing.",
    "",
    `Vendor: ${data.vendorLabel}`,
    `Run date: ${data.runDate}`,
    `Pushed to: ${siteLabel(data)}`,
    "",
    `Total rows: ${data.runSummary.total}`,
    `${data.target === "rollback" ? "Rolled back" : "Pushed"}: ${data.pushed}`,
    `Failed: ${data.failed}`,
    `Verification mismatches: ${data.verificationMismatches}`,
    "",
    `Clean: ${data.runSummary.byReviewClass.CLEAN ?? 0} -- ${runLink}?reviewClass=CLEAN`,
    `Updated: ${data.pushed} -- ${runLink}?reviewClass=CLEAN,WARNING&decisionStatus=APPROVED`,
    `Warning: ${data.runSummary.byReviewClass.WARNING ?? 0} -- ${runLink}?reviewClass=WARNING`,
    `Skipped: ${data.skippedCount} -- ${runLink}?reviewClass=CLEAN,WARNING,BLOCKED,UNCHANGED&decisionStatus=PENDING,REJECTED`,
  ];
  if (data.warningBreakdown.length > 0) {
    lines.push("", "Warning breakdown:");
    for (const w of data.warningBreakdown) lines.push(`  ${w.code}: ${w.count}`);
  }
  if (data.failedRowSamples.length > 0) {
    lines.push("", "Failed rows (sample):");
    for (const r of data.failedRowSamples.slice(0, MAX_FAILED_SAMPLES)) lines.push(`  ${r.productCode} -- ${r.errorMessage}`);
  }
  lines.push("", `View run: ${runLink}`, `View batch: ${data.appBaseUrl}/batches/${data.batchId}`);
  return lines.join("\n");
}
