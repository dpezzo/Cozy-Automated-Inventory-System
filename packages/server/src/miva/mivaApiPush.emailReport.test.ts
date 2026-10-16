import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BatchCsvRow } from "@cozywinters/shared";
import { buildCustomFieldValuesPayload } from "./mivaFieldMap";

const insertAuditLog = vi.fn();
const findBatchById = vi.fn();
const findFileById = vi.fn();
const updateBatchImportStatus = vi.fn();
const markBatchRolledBack = vi.fn();
const getMivaActiveSite = vi.fn().mockResolvedValue("development");

vi.mock("../db", () => ({
  getRepository: () => ({
    findBatchById,
    findFileById,
    insertAuditLog,
    updateBatchImportStatus,
    markBatchRolledBack,
    getMivaActiveSite,
  }),
}));

vi.mock("../storage/fileStorage", () => ({
  readStoredFileText: () => "irrelevant -- readBatchCsv is mocked below",
  storedFileExists: () => true,
}));

const sendBatchReportEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("../mail/sendBatchReportEmail", () => ({ sendBatchReportEmail: (...args: unknown[]) => sendBatchReportEmail(...args) }));

function row(productCode: string): BatchCsvRow {
  return {
    PRODUCT_CODE: productCode,
    "*CUSTOM_SIMPLE_INVENTORY": "IN STOCK",
    "*DF-AVAILABILITY": "in stock",
    "*ORD-INV_RESTOCK_DATE_DF-MERG-IN:": "",
    "*DF-DATAFEED": "Yes",
    "*DF-SHOPPING_FEED": "",
    DROPSHIP_INVENTORY_MANAGEMENT: "1",
  };
}

const rows: BatchCsvRow[] = [row("P0001")];
vi.mock("../domain/batchCsvIO", () => ({ readBatchCsv: () => rows }));

const callMivaApi = vi.fn();
vi.mock("./mivaApiClient", () => ({ callMivaApi: (...args: unknown[]) => callMivaApi(...args) }));

/** Echoes back every row's own pushed field values, so verifyPushedRows finds zero mismatches -- a clean success, not just a 200 response. */
function cleanVerificationResponse() {
  return {
    data: {
      data: rows.map((r) => ({
        code: r.PRODUCT_CODE,
        CustomField_Values: buildCustomFieldValuesPayload({
          simpleInventory: r["*CUSTOM_SIMPLE_INVENTORY"],
          availability: r["*DF-AVAILABILITY"],
          restockMessage: r["*ORD-INV_RESTOCK_DATE_DF-MERG-IN:"],
          dataFeed: r["*DF-DATAFEED"],
          shoppingFeed: r["*DF-SHOPPING_FEED"],
          dsInvMgt: r["DROPSHIP_INVENTORY_MANAGEMENT"],
        }),
      })),
    },
  };
}

describe("pushBatchToMiva email report hook", () => {
  beforeEach(() => {
    process.env.MIVA_ENVIRONMENT = "development";
    findBatchById.mockReset().mockResolvedValue({ id: "batch-1", updateFileId: "file-1", rollbackFileId: "file-1" });
    findFileById.mockReset().mockResolvedValue({ id: "file-1", storagePath: "irrelevant" });
    insertAuditLog.mockReset();
    updateBatchImportStatus.mockReset();
    markBatchRolledBack.mockReset();
    callMivaApi.mockReset();
    sendBatchReportEmail.mockReset().mockResolvedValue(undefined);
  });

  it("sends a report with target=update, action=API_PUSH_SUCCEEDED on a clean update push", async () => {
    callMivaApi.mockImplementation(async (body: { Function: string; Iterations?: unknown[] }) => {
      if (body.Function === "Product_Update") return (body.Iterations as unknown[]).map(() => ({ success: 1 }));
      if (body.Function === "ProductList_Load_Query") return cleanVerificationResponse();
      throw new Error(`Unexpected Function: ${body.Function}`);
    });

    const { pushBatchToMiva } = await import("./mivaApiPush");
    await pushBatchToMiva("batch-1", "user-1", true, "update");

    expect(sendBatchReportEmail).toHaveBeenCalledTimes(1);
    const call = sendBatchReportEmail.mock.calls[0]![0];
    expect(call.batchId).toBe("batch-1");
    expect(call.target).toBe("update");
    expect(call.action).toBe("API_PUSH_SUCCEEDED");
  });

  it("sends a report with target=rollback on a rollback push", async () => {
    callMivaApi.mockImplementation(async (body: { Function: string; Iterations?: unknown[] }) => {
      if (body.Function === "Product_Update") return (body.Iterations as unknown[]).map(() => ({ success: 1 }));
      if (body.Function === "ProductList_Load_Query") return cleanVerificationResponse();
      throw new Error(`Unexpected Function: ${body.Function}`);
    });

    const { pushBatchToMiva } = await import("./mivaApiPush");
    await pushBatchToMiva("batch-1", "user-1", true, "rollback");

    expect(sendBatchReportEmail).toHaveBeenCalledTimes(1);
    expect(sendBatchReportEmail.mock.calls[0]![0].target).toBe("rollback");
  });

  // pushBatchToMiva() calls sendBatchReportEmail() unguarded (no try/catch at
  // the call site) -- by design, since that function must swallow all of its
  // own errors (see sendBatchReportEmail.test.ts). mivaApiPush.partialFailure.test.ts
  // already exercises a real chunk failure against the real (unmocked, and in
  // this test env unconfigured/no-op) sendBatchReportEmail and confirms the
  // original chunkError still rethrows -- i.e. the real implementation never
  // masks it. This file only verifies the hook is wired with the right
  // arguments and doesn't change pushBatchToMiva()'s own return value.

  it("still returns the normal PushBatchResult on success even though sendBatchReportEmail is awaited", async () => {
    callMivaApi.mockImplementation(async (body: { Function: string; Iterations?: unknown[] }) => {
      if (body.Function === "Product_Update") return (body.Iterations as unknown[]).map(() => ({ success: 1 }));
      if (body.Function === "ProductList_Load_Query") return { data: { data: [] } };
      throw new Error(`Unexpected Function: ${body.Function}`);
    });

    const { pushBatchToMiva } = await import("./mivaApiPush");
    const result = await pushBatchToMiva("batch-1", "user-1", true, "update");
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(0);
  });
});
