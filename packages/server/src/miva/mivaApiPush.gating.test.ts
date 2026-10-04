import { describe, it, expect, vi, beforeEach } from "vitest";

const findBatchById = vi.fn();
const findFileById = vi.fn();
const insertAuditLog = vi.fn();
const updateBatchImportStatus = vi.fn();
const markBatchRolledBack = vi.fn();
const getMivaActiveSite = vi.fn();

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

describe("pushBatchToMiva production confirmation gate", () => {
  beforeEach(() => {
    findBatchById.mockReset().mockResolvedValue({ id: "batch-1", updateFileId: "file-1" });
    findFileById.mockReset();
    insertAuditLog.mockReset();
    getMivaActiveSite.mockReset();
  });

  it("throws PRODUCTION_CONFIRMATION_REQUIRED and never touches the file/API when the active site is live without confirmation", async () => {
    getMivaActiveSite.mockResolvedValue("live");
    const { pushBatchToMiva } = await import("./mivaApiPush");
    await expect(pushBatchToMiva("batch-1", "user-1", false)).rejects.toMatchObject({
      code: "PRODUCTION_CONFIRMATION_REQUIRED",
    });
    expect(findFileById).not.toHaveBeenCalled();
  });

  it("does not throw the gate error when the active site is development, even without confirmProduction", async () => {
    getMivaActiveSite.mockResolvedValue("development");
    findFileById.mockResolvedValue(null); // fails later (FILE_NOT_FOUND), proving the gate itself was passed
    const { pushBatchToMiva } = await import("./mivaApiPush");
    await expect(pushBatchToMiva("batch-1", "user-1", false)).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  it("fails closed (requires confirmation) when the active site is live", async () => {
    // "live" is the one other value getMivaActiveSite can return (it defaults
    // to "development" itself when the app_settings row is absent -- see
    // sqliteRepository.ts/postgresRepository.ts) -- there's no "unset" state
    // to simulate at this layer anymore, unlike the old MIVA_ENVIRONMENT env
    // var, since the repository method's own return type excludes it.
    getMivaActiveSite.mockResolvedValue("live");
    const { pushBatchToMiva } = await import("./mivaApiPush");
    await expect(pushBatchToMiva("batch-1", "user-1", false)).rejects.toMatchObject({
      code: "PRODUCTION_CONFIRMATION_REQUIRED",
    });
    expect(findFileById).not.toHaveBeenCalled();
  });

  it("reads the rollback file (not the update file) when target is 'rollback'", async () => {
    getMivaActiveSite.mockResolvedValue("development");
    findBatchById.mockResolvedValue({ id: "batch-1", updateFileId: "update-file", rollbackFileId: "rollback-file" });
    findFileById.mockResolvedValue(null); // fails later (FILE_NOT_FOUND), proving which file id it looked up
    const { pushBatchToMiva } = await import("./mivaApiPush");
    await expect(pushBatchToMiva("batch-1", "user-1", false, "rollback")).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
    });
    expect(findFileById).toHaveBeenCalledWith("rollback-file");
  });

  it("reports BATCH_INCOMPLETE when the batch has no rollback file", async () => {
    getMivaActiveSite.mockResolvedValue("development");
    findBatchById.mockResolvedValue({ id: "batch-1", updateFileId: "update-file", rollbackFileId: null });
    const { pushBatchToMiva } = await import("./mivaApiPush");
    await expect(pushBatchToMiva("batch-1", "user-1", false, "rollback")).rejects.toMatchObject({
      code: "BATCH_INCOMPLETE",
    });
    expect(findFileById).not.toHaveBeenCalled();
  });
});

describe("resolveMivaPushEnvironment", () => {
  beforeEach(() => {
    getMivaActiveSite.mockReset();
  });

  // Regression test: GET /miva/api-status (which decides whether the UI shows
  // the confirmation checkbox) must agree with pushBatchToMiva's own gate on
  // every input -- they previously used different defaults (this function
  // returning "production" for anything but a literal MIVA_ENVIRONMENT value
  // of "development", while the status route defaulted an unset env var to
  // "development"), so a real deployment with no MIVA_ENVIRONMENT set showed
  // no checkbox at all yet still rejected the push with
  // PRODUCTION_CONFIRMATION_REQUIRED. Both now read the exact same
  // getMivaActiveSite() call, so they cannot disagree.
  it.each([
    ["development", "development"],
    ["live", "production"],
  ] as const)("miva_active_site=%s -> %s", async (site, expected) => {
    getMivaActiveSite.mockResolvedValue(site);
    const { resolveMivaPushEnvironment } = await import("./mivaApiPush");
    expect(await resolveMivaPushEnvironment()).toBe(expected);
  });
});
