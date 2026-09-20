import { describe, it, expect, vi, beforeEach } from "vitest";

const findFileById = vi.fn();
const listRuns = vi.fn();
const insertRun = vi.fn();

vi.mock("../db", () => ({
  getRepository: () => ({ findFileById, listRuns, insertRun }),
}));

vi.mock("../vendor/vendorFileRegistry", () => ({
  getVendorFileAdapter: () => ({ vendorKey: "olliix", parse: async () => ({ rows: [] }) }),
}));

function vendorFile(id: string) {
  return { id, kind: "olliix_workbook", storagePath: "irrelevant" };
}
function mivaFile(id: string) {
  return { id, kind: "miva_snapshot", storagePath: "irrelevant" };
}

describe("createRun duplicate-run guard", () => {
  beforeEach(() => {
    findFileById.mockReset();
    listRuns.mockReset();
    insertRun.mockReset();
  });

  it("rejects creating a run for a vendor+Miva file pair that already has a non-failed run", async () => {
    findFileById.mockImplementation(async (id: string) => (id === "v1" ? vendorFile("v1") : mivaFile("m1")));
    listRuns.mockResolvedValue([
      { id: "run-existing", vendorFileId: "v1", mivaFileId: "m1", status: "ready" },
    ]);

    const { createRun } = await import("./runService");
    await expect(
      createRun({ vendorFileId: "v1", mivaFileId: "m1", runDate: { year: 2026, month: 9, day: 18 }, createdBy: "u1" }),
    ).rejects.toMatchObject({ code: "DUPLICATE_RUN" });
    expect(insertRun).not.toHaveBeenCalled();
  });

  it("allows creating a run again when the only prior run for the pair failed", async () => {
    findFileById.mockImplementation(async (id: string) => (id === "v1" ? vendorFile("v1") : mivaFile("m1")));
    listRuns.mockResolvedValue([
      { id: "run-failed", vendorFileId: "v1", mivaFileId: "m1", status: "failed" },
    ]);
    insertRun.mockResolvedValue({ id: "run-new", status: "validating" });

    const { createRun } = await import("./runService");
    // The rest of createRun's pipeline (parsing/reconciliation) isn't mocked here, so it will
    // fail further along -- what this test asserts is that the duplicate guard itself does not
    // block this call, i.e. insertRun (the guard's gate) is reached.
    await createRun({
      vendorFileId: "v1",
      mivaFileId: "m1",
      runDate: { year: 2026, month: 9, day: 18 },
      createdBy: "u1",
    }).catch(() => undefined);
    expect(insertRun).toHaveBeenCalled();
  });

  it("does not block a run for a different vendor/Miva file pair", async () => {
    findFileById.mockImplementation(async (id: string) => (id === "v2" ? vendorFile("v2") : mivaFile("m2")));
    listRuns.mockResolvedValue([{ id: "run-existing", vendorFileId: "v1", mivaFileId: "m1", status: "ready" }]);
    insertRun.mockResolvedValue({ id: "run-new", status: "validating" });

    const { createRun } = await import("./runService");
    await createRun({
      vendorFileId: "v2",
      mivaFileId: "m2",
      runDate: { year: 2026, month: 9, day: 18 },
      createdBy: "u1",
    }).catch(() => undefined);
    expect(insertRun).toHaveBeenCalled();
  });
});
