import { describe, it, expect } from "vitest";
import {
  renderBatchReportSubject,
  renderBatchReportHtml,
  renderBatchReportText,
  type BatchReportEmailData,
  type BatchPushAction,
} from "./batchReportTemplate";
import type { MivaPushTarget } from "../miva/mivaApiPush";

function baseData(overrides: Partial<BatchReportEmailData> = {}): BatchReportEmailData {
  return {
    target: "update",
    action: "API_PUSH_SUCCEEDED",
    activeSite: "development",
    batchId: "batch-123",
    runId: "run-456",
    runDate: "2026-10-15",
    vendorLabel: "Acme Test Brand",
    appBaseUrl: "https://app.example.com",
    pushed: 10,
    failed: 0,
    verificationMismatches: 0,
    unattempted: 0,
    runSummary: { total: 20, byReviewClass: { CLEAN: 10, WARNING: 5, BLOCKED: 5 }, changed: 10, unchanged: 10 },
    warningBreakdown: [{ code: "MIVA_PARENT_INACTIVE", count: 3 }],
    skippedCount: 5,
    failedRowSamples: [],
    ...overrides,
  };
}

const COMBINATIONS: { target: MivaPushTarget; action: BatchPushAction }[] = [
  { target: "update", action: "API_PUSH_SUCCEEDED" },
  { target: "update", action: "API_PUSH_FAILED" },
  { target: "update", action: "API_PUSH_PARTIAL_FAILURE" },
  { target: "rollback", action: "API_PUSH_SUCCEEDED" },
  { target: "rollback", action: "API_PUSH_FAILED" },
  { target: "rollback", action: "API_PUSH_PARTIAL_FAILURE" },
];

describe("renderBatchReportSubject / renderBatchReportHtml / renderBatchReportText", () => {
  it.each(COMBINATIONS)("renders without throwing for target=$target action=$action", ({ target, action }) => {
    const data = baseData({ target, action });
    expect(() => renderBatchReportSubject(data)).not.toThrow();
    expect(() => renderBatchReportHtml(data)).not.toThrow();
    expect(() => renderBatchReportText(data)).not.toThrow();
  });

  it("frames a successful update push distinctly from a successful rollback", () => {
    expect(renderBatchReportSubject(baseData({ target: "update", action: "API_PUSH_SUCCEEDED" }))).toMatch(/^Batch push succeeded/);
    expect(renderBatchReportSubject(baseData({ target: "rollback", action: "API_PUSH_SUCCEEDED" }))).toMatch(/^Rollback succeeded/);
  });

  it("flags failures and partial failures with a warning marker, for both targets", () => {
    expect(renderBatchReportSubject(baseData({ action: "API_PUSH_FAILED" }))).toMatch(/^⚠ Batch push failed/);
    expect(renderBatchReportSubject(baseData({ action: "API_PUSH_PARTIAL_FAILURE" }))).toMatch(/^⚠ Batch push partially failed/);
    expect(renderBatchReportSubject(baseData({ target: "rollback", action: "API_PUSH_FAILED" }))).toMatch(/^⚠ Rollback failed/);
  });

  it("includes the exact run and batch links given appBaseUrl/runId/batchId", () => {
    const html = renderBatchReportHtml(baseData());
    expect(html).toContain('href="https://app.example.com/runs/run-456"');
    expect(html).toContain('href="https://app.example.com/batches/batch-123"');
    const text = renderBatchReportText(baseData());
    expect(text).toContain("https://app.example.com/runs/run-456");
    expect(text).toContain("https://app.example.com/batches/batch-123");
  });

  it("caps a long failed-row sample list and shows a '+N more' remainder", () => {
    const failedRowSamples = Array.from({ length: 8 }, (_, i) => ({ productCode: `P${i}`, errorMessage: "Boom" }));
    const html = renderBatchReportHtml(baseData({ failed: 8, failedRowSamples }));
    expect(html).toContain("P0 -- Boom");
    expect(html).toContain("P4 -- Boom");
    expect(html).not.toContain("P5 -- Boom");
    expect(html).toContain("+3 more");
  });

  it("uses inline style attributes rather than relying on a <style> block (Gmail strips <style>)", () => {
    const html = renderBatchReportHtml(baseData());
    expect(html).not.toMatch(/<style[\s>]/);
    expect(html).toMatch(/style="[^"]*"/);
  });

  it("escapes HTML-significant characters in vendor label and error messages", () => {
    const html = renderBatchReportHtml(
      baseData({ vendorLabel: "<script>alert(1)</script>", failedRowSamples: [{ productCode: "P1", errorMessage: "<b>bad</b>" }] }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<b>bad</b>");
  });
});
