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

describe("resolveMivaPushEnvironment", () => {
  const originalEnv = process.env.MIVA_ENVIRONMENT;

  afterEach(() => {
    process.env.MIVA_ENVIRONMENT = originalEnv;
  });

  // Regression test: GET /miva/api-status (which decides whether the UI shows
  // the confirmation checkbox) must agree with pushBatchToMiva's own gate on
  // every input -- they previously used different defaults (this function
  // returning "production" for anything but literal "development", while the
  // status route defaulted an unset env var to "development"), so a real
  // deployment with no MIVA_ENVIRONMENT set showed no checkbox at all yet
  // still rejected the push with PRODUCTION_CONFIRMATION_REQUIRED.
  it.each([
    ["development", "development"],
    ["production", "production"],
    ["", "production"],
    [undefined, "production"],
    ["prod", "production"],
    ["DEVELOPMENT", "development"],
  ] as const)("MIVA_ENVIRONMENT=%s -> %s", async (raw, expected) => {
    if (raw === undefined) delete process.env.MIVA_ENVIRONMENT;
    else process.env.MIVA_ENVIRONMENT = raw;
    const { resolveMivaPushEnvironment } = await import("./mivaApiPush");
    expect(resolveMivaPushEnvironment()).toBe(expected);
  });
});
