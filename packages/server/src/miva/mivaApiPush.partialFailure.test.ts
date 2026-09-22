import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BatchCsvRow } from "@cozywinters/shared";
import { buildCustomFieldValuesPayload } from "./mivaFieldMap";

const insertAuditLog = vi.fn();
const findBatchById = vi.fn();
const findFileById = vi.fn();
const updateBatchImportStatus = vi.fn();
const markBatchRolledBack = vi.fn();

vi.mock("../db", () => ({
  getRepository: () => ({ findBatchById, findFileById, insertAuditLog, updateBatchImportStatus, markBatchRolledBack }),
}));

vi.mock("../storage/fileStorage", () => ({
  readStoredFileText: () => "irrelevant -- readBatchCsv is mocked below",
}));

function row(productCode: string): BatchCsvRow {
  return {
    PRODUCT_CODE: productCode,
    "*CUSTOM_SIMPLE_INVENTORY": "IN STOCK",
    "*DF-AVAILABILITY": "in stock",
    "*ORD-INV_RESTOCK_DATE_DF-MERG-IN:": "",
    "*DF-DATAFEED": "Yes",
    "*DF-SHOPPING_FEED": "",
    "SHOW_IN_DARREN_INVENTORY_REPORT_(1)": "1",
  };
}

// 150 rows -> two Product_Update chunks of 100/50 given CHUNK_SIZE=100 in mivaApiPush.ts.
const rows: BatchCsvRow[] = Array.from({ length: 150 }, (_, i) => row(`P${String(i).padStart(4, "0")}`));

vi.mock("../domain/batchCsvIO", () => ({ readBatchCsv: () => rows }));

const callMivaApi = vi.fn();
vi.mock("./mivaApiClient", () => ({ callMivaApi: (...args: unknown[]) => callMivaApi(...args) }));

describe("pushBatchToMiva partial-batch failure", () => {
  beforeEach(() => {
    process.env.MIVA_ENVIRONMENT = "development";
    findBatchById.mockReset().mockResolvedValue({ id: "batch-1", updateFileId: "file-1" });
    findFileById.mockReset().mockResolvedValue({ id: "file-1", storagePath: "irrelevant" });
    insertAuditLog.mockReset();
    updateBatchImportStatus.mockReset();
    markBatchRolledBack.mockReset();
    callMivaApi.mockReset();
  });

  it("records an audit log entry for rows already pushed before a later chunk fails, then rethrows", async () => {
    let productUpdateCalls = 0;
    callMivaApi.mockImplementation(async (body: { Function: string; Iterations?: unknown[] }) => {
      if (body.Function === "Product_Update") {
        productUpdateCalls += 1;
        // First chunk succeeds; second chunk's call throws (e.g. exhausted retries).
        if (productUpdateCalls === 1) {
          return (body.Iterations as unknown[]).map(() => ({ success: 1 }));
        }
        throw new Error("Miva API request failed after retries.");
      }
      if (body.Function === "ProductList_Load_Query") {
        return { data: { data: [] } }; // no products found -- fine, verification mismatch count isn't asserted here.
      }
      throw new Error(`Unexpected Function in test: ${body.Function}`);
    });

    const { pushBatchToMiva } = await import("./mivaApiPush");
    await expect(pushBatchToMiva("batch-1", "user-1", true)).rejects.toThrow(
      "Miva API request failed after retries.",
    );

    expect(insertAuditLog).toHaveBeenCalledTimes(1);
    const call = insertAuditLog.mock.calls[0]![0];
    expect(call.action).toBe("API_PUSH_PARTIAL_FAILURE");
    expect(call.details.pushed).toBe(100);
    expect(call.details.unattempted).toBe(50);
    expect(call.details.chunkError).toMatch(/failed after retries/i);

    expect(updateBatchImportStatus).toHaveBeenCalledWith("batch-1", "API_PUSH_PARTIAL_FAILURE");
    expect(markBatchRolledBack).not.toHaveBeenCalled();
  });
});

describe("pushBatchToMiva import status updates", () => {
  beforeEach(() => {
    process.env.MIVA_ENVIRONMENT = "development";
    findBatchById.mockReset().mockResolvedValue({
      id: "batch-1",
      updateFileId: "file-1",
      rollbackFileId: "file-1",
    });
    findFileById.mockReset().mockResolvedValue({ id: "file-1", storagePath: "irrelevant" });
    insertAuditLog.mockReset();
    updateBatchImportStatus.mockReset();
    markBatchRolledBack.mockReset();
    callMivaApi.mockReset();
    callMivaApi.mockImplementation(async (body: { Function: string; Iterations?: unknown[] }) => {
      if (body.Function === "Product_Update") {
        return (body.Iterations as unknown[]).map(() => ({ success: 1 }));
      }
      if (body.Function === "ProductList_Load_Query") {
        // Echo back every row's own pushed field values, so verifyPushedRows
        // finds zero mismatches and the push counts as a clean success.
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
                reportFlag: r["SHOW_IN_DARREN_INVENTORY_REPORT_(1)"],
              }),
            })),
          },
        };
      }
      throw new Error(`Unexpected Function in test: ${body.Function}`);
    });
  });

  it("sets import_status to API_PUSH_SUCCEEDED on a fully successful update push, without touching rolled_back_at", async () => {
    const { pushBatchToMiva } = await import("./mivaApiPush");
    await pushBatchToMiva("batch-1", "user-1", true, "update");
    expect(updateBatchImportStatus).toHaveBeenCalledWith("batch-1", "API_PUSH_SUCCEEDED");
    expect(markBatchRolledBack).not.toHaveBeenCalled();
  });

  it("marks the batch rolled back on a rollback push, without touching import_status", async () => {
    const { pushBatchToMiva } = await import("./mivaApiPush");
    await pushBatchToMiva("batch-1", "user-1", true, "rollback");
    expect(markBatchRolledBack).toHaveBeenCalledWith("batch-1");
    expect(updateBatchImportStatus).not.toHaveBeenCalled();
  });
});
