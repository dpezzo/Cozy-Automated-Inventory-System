import { describe, it, expect } from "vitest";

// routes.ts imports several modules (db, multer, domain services) at module
// scope that aren't needed to exercise resolveRunDate in isolation; mock them
// out so this test only depends on the pure date-parsing logic under test.
import { vi } from "vitest";
vi.mock("./db", () => ({ getRepository: () => ({}) }));
vi.mock("./storage/fileStorage", () => ({ readStoredFile: () => Buffer.from(""), readStoredFileText: () => "" }));
vi.mock("./domain/uploadService", () => ({ uploadFile: () => ({}), uploadVendorFileAutoDetect: () => ({}) }));
vi.mock("./miva/mivaProducts", () => ({ pullMivaSnapshotFromApi: () => ({}) }));
vi.mock("./miva/mivaApiClient", () => ({ isMivaApiConfigured: () => false }));
vi.mock("./vendor/mivaCsv", () => ({ parseMivaSnapshotCsv: () => ({ rows: [] }) }));
vi.mock("./domain/runService", () => ({
  createRun: () => ({}),
  getRunSummary: () => ({}),
  approveAllClean: () => 0,
  setRowDecision: () => undefined,
  bulkDecision: () => ({ applied: 0, skipped: [] }),
  getBatchableRows: () => [],
}));
vi.mock("./domain/batchService", () => ({ generateBatch: () => ({}) }));
vi.mock("./domain/legacyService", () => ({ runLegacyComparison: () => "" }));
vi.mock("./domain/verificationService", () => ({ runPostImportVerification: () => "" }));
vi.mock("./miva/mivaApiPush", () => ({ pushBatchToMiva: () => ({}) }));

import { resolveRunDate } from "./routes";

describe("resolveRunDate", () => {
  it("parses an explicit YYYY-MM-DD runDate as its literal calendar date, with no timezone shift", () => {
    expect(resolveRunDate("2026-09-18")).toEqual({ year: 2026, month: 9, day: 18 });
  });

  it("does not shift a date near the UTC/America-New-York day boundary", () => {
    // Regression check for the bug where parsing as UTC midnight and reprojecting
    // to America/New_York (UTC-4/-5) silently shifted the date back by one day.
    expect(resolveRunDate("2026-01-01")).toEqual({ year: 2026, month: 1, day: 1 });
    expect(resolveRunDate("2026-12-31")).toEqual({ year: 2026, month: 12, day: 31 });
  });

  it("rejects a malformed runDate", () => {
    expect(() => resolveRunDate("09/18/2026")).toThrow(/YYYY-MM-DD/);
  });

  it("defaults to today in America/New_York when no runDate is given", () => {
    // Pick an instant that is a different calendar day in UTC vs. America/New_York
    // (11pm Eastern on a winter night is already the next day in UTC).
    const winterMidnightUTC = new Date("2026-01-15T23:30:00-05:00"); // 2026-01-15 23:30 America/New_York
    expect(resolveRunDate(undefined, winterMidnightUTC)).toEqual({ year: 2026, month: 1, day: 15 });
  });
});
