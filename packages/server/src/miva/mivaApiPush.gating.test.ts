import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const findBatchById = vi.fn();
const findFileById = vi.fn();
const insertAuditLog = vi.fn();

vi.mock("../db", () => ({
  getRepository: () => ({ findBatchById, findFileById, insertAuditLog }),
}));

describe("pushBatchToMiva production confirmation gate", () => {
  const originalEnv = process.env.MIVA_ENVIRONMENT;

  beforeEach(() => {
    findBatchById.mockReset().mockResolvedValue({ id: "batch-1", updateFileId: "file-1" });
    findFileById.mockReset();
    insertAuditLog.mockReset();
  });

  afterEach(() => {
    process.env.MIVA_ENVIRONMENT = originalEnv;
  });

  it("throws PRODUCTION_CONFIRMATION_REQUIRED and never touches the file/API when in production without confirmation", async () => {
    process.env.MIVA_ENVIRONMENT = "production";
    const { pushBatchToMiva } = await import("./mivaApiPush");
    await expect(pushBatchToMiva("batch-1", "user-1", false)).rejects.toMatchObject({
      code: "PRODUCTION_CONFIRMATION_REQUIRED",
    });
    expect(findFileById).not.toHaveBeenCalled();
  });

  it("does not throw the gate error in development, even without confirmProduction", async () => {
    process.env.MIVA_ENVIRONMENT = "development";
    findFileById.mockResolvedValue(null); // fails later (FILE_NOT_FOUND), proving the gate itself was passed
    const { pushBatchToMiva } = await import("./mivaApiPush");
    await expect(pushBatchToMiva("batch-1", "user-1", false)).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  it("fails closed (requires confirmation) when MIVA_ENVIRONMENT is unset", async () => {
    delete process.env.MIVA_ENVIRONMENT;
    const { pushBatchToMiva } = await import("./mivaApiPush");
    await expect(pushBatchToMiva("batch-1", "user-1", false)).rejects.toMatchObject({
      code: "PRODUCTION_CONFIRMATION_REQUIRED",
    });
    expect(findFileById).not.toHaveBeenCalled();
  });

  it("fails closed (requires confirmation) when MIVA_ENVIRONMENT is misspelled/unrecognized", async () => {
    process.env.MIVA_ENVIRONMENT = "prod";
    const { pushBatchToMiva } = await import("./mivaApiPush");
    await expect(pushBatchToMiva("batch-1", "user-1", false)).rejects.toMatchObject({
      code: "PRODUCTION_CONFIRMATION_REQUIRED",
    });
    expect(findFileById).not.toHaveBeenCalled();
  });

  it("reads the rollback file (not the update file) when target is 'rollback'", async () => {
    process.env.MIVA_ENVIRONMENT = "development";
    findBatchById.mockResolvedValue({ id: "batch-1", updateFileId: "update-file", rollbackFileId: "rollback-file" });
    findFileById.mockResolvedValue(null); // fails later (FILE_NOT_FOUND), proving which file id it looked up
    const { pushBatchToMiva } = await import("./mivaApiPush");
    await expect(pushBatchToMiva("batch-1", "user-1", false, "rollback")).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
    });
    expect(findFileById).toHaveBeenCalledWith("rollback-file");
  });

  it("reports BATCH_INCOMPLETE when the batch has no rollback file", async () => {
    process.env.MIVA_ENVIRONMENT = "development";
    findBatchById.mockResolvedValue({ id: "batch-1", updateFileId: "update-file", rollbackFileId: null });
    const { pushBatchToMiva } = await import("./mivaApiPush");
    await expect(pushBatchToMiva("batch-1", "user-1", false, "rollback")).rejects.toMatchObject({
      code: "BATCH_INCOMPLETE",
    });
    expect(findFileById).not.toHaveBeenCalled();
  });
});
