import { describe, it, expect, vi, beforeEach } from "vitest";

const getMivaActiveSite = vi.fn();
const getDevResetReferenceFileId = vi.fn();
const findFileById = vi.fn();
const insertAuditLog = vi.fn();

vi.mock("../db", () => ({
  getRepository: () => ({
    getMivaActiveSite,
    getDevResetReferenceFileId,
    findFileById,
    insertAuditLog,
  }),
}));

vi.mock("../storage/fileStorage", () => ({
  readStoredFileText: () => "irrelevant",
  saveUploadedFile: () => ({ storagePath: "irrelevant", checksum: "irrelevant", sizeBytes: 0 }),
  computeChecksum: () => "irrelevant",
}));

describe("resetDevSiteProducts", () => {
  beforeEach(() => {
    getMivaActiveSite.mockReset();
    getDevResetReferenceFileId.mockReset();
    findFileById.mockReset();
    insertAuditLog.mockReset();
  });

  it("refuses to run when the active site is live, with no override possible", async () => {
    getMivaActiveSite.mockResolvedValue("live");
    const { resetDevSiteProducts } = await import("./devReset");
    await expect(resetDevSiteProducts("user-1")).rejects.toMatchObject({
      code: "DEV_RESET_REQUIRES_DEVELOPMENT_SITE",
    });
    // Never even looks at the reference file when the site gate fails.
    expect(getDevResetReferenceFileId).not.toHaveBeenCalled();
  });

  it("refuses to run when no reference file has ever been uploaded", async () => {
    getMivaActiveSite.mockResolvedValue("development");
    getDevResetReferenceFileId.mockResolvedValue(null);
    const { resetDevSiteProducts } = await import("./devReset");
    await expect(resetDevSiteProducts("user-1")).rejects.toMatchObject({
      code: "NO_RESET_REFERENCE_FILE",
    });
    expect(findFileById).not.toHaveBeenCalled();
  });
});
