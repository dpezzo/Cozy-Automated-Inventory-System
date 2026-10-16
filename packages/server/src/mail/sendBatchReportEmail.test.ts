import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getRepository = vi.fn();
vi.mock("../db", () => ({ getRepository: () => getRepository() }));

const getResendClient = vi.fn();
vi.mock("./resendClient", () => ({ getResendClient: () => getResendClient() }));

const getRunSummary = vi.fn();
const getWarningCodeBreakdown = vi.fn();
vi.mock("../domain/runService", () => ({
  getRunSummary: (...args: unknown[]) => getRunSummary(...args),
  getWarningCodeBreakdown: (...args: unknown[]) => getWarningCodeBreakdown(...args),
}));

vi.mock("../domain/batchService", () => ({ vendorSlugFromRuleId: (ruleId: string) => ruleId.split("-")[0] }));

function baseRepo(overrides: Record<string, unknown> = {}) {
  return {
    getReportEnabled: vi.fn().mockResolvedValue(true),
    getReportRecipientEmail: vi.fn().mockResolvedValue("ops@example.com"),
    getMivaActiveSite: vi.fn().mockResolvedValue("development"),
    findBatchById: vi.fn().mockResolvedValue({ id: "batch-1", runId: "run-1" }),
    findRunById: vi.fn().mockResolvedValue({ id: "run-1", ruleId: "acme-inventory-v1", runDate: "2026-10-15" }),
    findVendorConfigByKey: vi.fn().mockResolvedValue({ vendorLabel: "Acme Test Brand" }),
    ...overrides,
  };
}

function basePushResult() {
  return {
    pushed: 5,
    failed: 0,
    verificationMismatches: 0,
    results: [
      { productCode: "P1", success: true },
      { productCode: "P2", success: true },
    ],
  };
}

describe("sendBatchReportEmail", () => {
  const send = vi.fn().mockResolvedValue({ data: { id: "email-1" }, error: null });

  beforeEach(() => {
    getRepository.mockReset();
    getResendClient.mockReset();
    getRunSummary
      .mockReset()
      .mockResolvedValue({ total: 10, byReviewClass: { CLEAN: 8, WARNING: 2 }, byDecisionStatus: { APPROVED: 10 }, changed: 2, unchanged: 8 });
    getWarningCodeBreakdown.mockReset().mockResolvedValue([]);
    send.mockClear();
    // getResendClient() itself is mocked above, so RESEND_API_KEY is irrelevant here --
    // only APP_BASE_URL (read directly in sendBatchReportEmail.ts) needs stubbing.
    vi.stubEnv("APP_BASE_URL", "https://app.example.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never calls resend.emails.send when getResendClient() returns null (no API key configured)", async () => {
    getResendClient.mockReturnValue(null);
    getRepository.mockReturnValue(baseRepo());

    const { sendBatchReportEmail } = await import("./sendBatchReportEmail");
    await expect(
      sendBatchReportEmail({ batchId: "batch-1", target: "update", action: "API_PUSH_SUCCEEDED", pushResult: basePushResult() }),
    ).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
  });

  it("never calls resend.emails.send when reports are disabled, even if a key is configured", async () => {
    getResendClient.mockReturnValue({ emails: { send } });
    getRepository.mockReturnValue(baseRepo({ getReportEnabled: vi.fn().mockResolvedValue(false) }));

    const { sendBatchReportEmail } = await import("./sendBatchReportEmail");
    await sendBatchReportEmail({ batchId: "batch-1", target: "update", action: "API_PUSH_SUCCEEDED", pushResult: basePushResult() });

    expect(send).not.toHaveBeenCalled();
  });

  it("sends to whatever the repository's recipient setting returns -- never a hardcoded address", async () => {
    getResendClient.mockReturnValue({ emails: { send } });
    getRepository.mockReturnValue(
      baseRepo({ getReportRecipientEmail: vi.fn().mockResolvedValue("someone-else@customdomain.com") }),
    );

    const { sendBatchReportEmail } = await import("./sendBatchReportEmail");
    await sendBatchReportEmail({ batchId: "batch-1", target: "update", action: "API_PUSH_SUCCEEDED", pushResult: basePushResult() });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].to).toBe("someone-else@customdomain.com");
  });

  it("swallows a resend.emails.send rejection and logs it, never throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockRejectedValueOnce(new Error("Resend API down"));
    getResendClient.mockReturnValue({ emails: { send } });
    getRepository.mockReturnValue(baseRepo());

    const { sendBatchReportEmail } = await import("./sendBatchReportEmail");
    await expect(
      sendBatchReportEmail({ batchId: "batch-1", target: "update", action: "API_PUSH_SUCCEEDED", pushResult: basePushResult() }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("resolves without sending when the batch or run can no longer be found", async () => {
    getResendClient.mockReturnValue({ emails: { send } });
    getRepository.mockReturnValue(baseRepo({ findBatchById: vi.fn().mockResolvedValue(null) }));

    const { sendBatchReportEmail } = await import("./sendBatchReportEmail");
    await sendBatchReportEmail({ batchId: "missing", target: "update", action: "API_PUSH_SUCCEEDED", pushResult: basePushResult() });

    expect(send).not.toHaveBeenCalled();
  });
});
