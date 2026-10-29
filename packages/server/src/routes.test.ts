import { describe, it, expect } from "vitest";

// routes.ts imports several modules (db, multer, domain services) at module
// scope that aren't needed to exercise resolveRunDate in isolation; mock them
// out so this test only depends on the pure date-parsing logic under test.
import { vi } from "vitest";
vi.mock("./db", () => ({ getRepository: () => ({}) }));
vi.mock("./storage/fileStorage", () => ({
  readStoredFile: () => Buffer.from(""),
  readStoredFileText: () => "",
  storedFileExists: () => true,
}));
vi.mock("./domain/uploadService", () => ({ uploadFile: () => ({}), uploadVendorFileAutoDetect: () => ({}) }));
vi.mock("./miva/mivaProducts", () => ({ pullMivaSnapshotFromApi: () => ({}) }));
vi.mock("./miva/mivaApiClient", () => ({ isMivaApiConfigured: () => false }));
vi.mock("./vendor/mivaCsv", () => ({ parseMivaSnapshotCsv: () => ({ rows: [] }) }));
vi.mock("./domain/runService", () => ({
  createRun: () => ({}),
  getRunSummary: () => ({}),
  approveAllClean: () => 0,
  approveAllSingleWarning: () => 0,
  setRowDecision: () => undefined,
  bulkDecision: () => ({ applied: 0, skipped: [] }),
  getBatchableRows: () => [],
  listUntrackedBrandRows: () => [],
}));
vi.mock("./domain/batchService", () => ({ generateBatch: () => ({}) }));
vi.mock("./domain/legacyService", () => ({ runLegacyComparison: () => "" }));
vi.mock("./domain/verificationService", () => ({ runPostImportVerification: () => "" }));
vi.mock("./miva/mivaApiPush", () => ({ pushBatchToMiva: () => ({}) }));

import { resolveRunDate, errorHandler } from "./routes";
import { ValidationError, ForbiddenError, NotFoundError } from "./errors";

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

describe("errorHandler", () => {
  function run(err: unknown) {
    const res = { statusCode: 0, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(b: unknown) { this.body = b; return this; } };
    const req = { method: "PATCH", path: "/vendors/olliix" };
    errorHandler(err, req as never, res as never, (() => undefined) as never);
    return res;
  }

  it("keeps the status and code of the app's own errors", () => {
    expect(run(new ValidationError("INVALID_THRESHOLD", "bad")).statusCode).toBe(422);
    expect(run(new NotFoundError("nope")).statusCode).toBe(404);
    expect(run(new ForbiddenError("no")).statusCode).toBe(403);
  });

  it("reports an unrecognized error as a generic 500 but logs the request and the database details", () => {
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logged.push(args));
    const dbError = Object.assign(new Error('column "discontinued_threshold" of relation "vendor_configs" does not exist'), {
      code: "42703",
      table: "vendor_configs",
    });
    const res = run(dbError);
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "INTERNAL_ERROR", message: "An unexpected error occurred." });
    const line = String(logged[0]![0]);
    expect(line).toContain("PATCH /vendors/olliix");
    expect(line).toContain("code=42703");
    expect(line).toContain("table=vendor_configs");
  });

  it("maps request-body problems to their real status instead of a 500", () => {
    expect(run(Object.assign(new Error("too big"), { type: "entity.too.large", status: 413 })).statusCode).toBe(413);
    expect(run(Object.assign(new SyntaxError("bad json"), { type: "entity.parse.failed", status: 400 })).statusCode).toBe(400);
  });
});
