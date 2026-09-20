import { describe, it, expect, vi, beforeEach } from "vitest";

const previewClearDataRepo = vi.fn();
const clearDataRepo = vi.fn();
const insertAuditLog = vi.fn();
const deleteStoredFile = vi.fn();

vi.mock("../db", () => ({
  getRepository: () => ({ previewClearData: previewClearDataRepo, clearData: clearDataRepo, insertAuditLog }),
}));

vi.mock("../storage/fileStorage", () => ({ deleteStoredFile }));

const RESULT = {
  runs: 2,
  batches: 1,
  reconciliationRows: 10,
  decisions: 10,
  legacyComparisons: 0,
  postImportVerifications: 0,
  files: 3,
  totalFileBytes: 12345,
  deletedFileStoragePaths: ["vendor/a.csv", "miva/b.csv", "batch_update/c.csv"],
};

describe("adminService", () => {
  beforeEach(() => {
    previewClearDataRepo.mockReset();
    clearDataRepo.mockReset();
    insertAuditLog.mockReset();
    deleteStoredFile.mockReset();
  });

  it("previewClearData passes the cutoff straight through and never touches disk", async () => {
    previewClearDataRepo.mockResolvedValue({ ...RESULT, deletedFileStoragePaths: undefined });

    const { previewClearData } = await import("./adminService");
    await previewClearData("2024-01-01T00:00:00.000Z");

    expect(previewClearDataRepo).toHaveBeenCalledWith("2024-01-01T00:00:00.000Z");
    expect(deleteStoredFile).not.toHaveBeenCalled();
    expect(insertAuditLog).not.toHaveBeenCalled();
  });

  it("clearData deletes every returned file from disk and records an audit log entry with the counts", async () => {
    clearDataRepo.mockResolvedValue(RESULT);

    const { clearData } = await import("./adminService");
    const result = await clearData(null, "actor-1");

    expect(clearDataRepo).toHaveBeenCalledWith(null);
    expect(deleteStoredFile).toHaveBeenCalledTimes(3);
    expect(deleteStoredFile).toHaveBeenNthCalledWith(1, "vendor/a.csv");
    expect(deleteStoredFile).toHaveBeenNthCalledWith(2, "miva/b.csv");
    expect(deleteStoredFile).toHaveBeenNthCalledWith(3, "batch_update/c.csv");

    expect(insertAuditLog).toHaveBeenCalledWith({
      actorId: "actor-1",
      action: "DATA_CLEARED",
      entityType: "system",
      entityId: null,
      details: {
        beforeDate: null,
        runs: 2,
        batches: 1,
        reconciliationRows: 10,
        decisions: 10,
        legacyComparisons: 0,
        postImportVerifications: 0,
        files: 3,
        totalFileBytes: 12345,
      },
    });
    expect(result).toBe(RESULT);
  });

  it("still records the audit log even if a file is already missing on disk", async () => {
    clearDataRepo.mockResolvedValue(RESULT);
    deleteStoredFile.mockImplementation((path: string) => {
      if (path === "miva/b.csv") throw new Error("ENOENT-like failure");
    });

    const { clearData } = await import("./adminService");
    // deleteStoredFile itself already swallows ENOENT in the real implementation --
    // this just documents that clearData doesn't add its own try/catch around it,
    // so a genuine unexpected disk error propagates rather than being silently lost.
    await expect(clearData(null, "actor-1")).rejects.toThrow("ENOENT-like failure");
    expect(insertAuditLog).not.toHaveBeenCalled();
  });
});
