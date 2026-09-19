import { describe, it, expect } from "vitest";
import { selectExpectedDate, parseCalendarDate } from "./dateRules";
import type { WarehouseCode, WarehouseEvidence } from "./types";

const RUN_DATE = { year: 2026, month: 9, day: 18 };

function warehouses(overrides: Partial<Record<WarehouseCode, Partial<WarehouseEvidence>>>) {
  const base: Record<WarehouseCode, WarehouseEvidence> = {
    WDC: { invQtyRaw: "0", incomingDateRaw: null, incomingQtyRaw: "0" },
    SD3: { invQtyRaw: "0", incomingDateRaw: null, incomingQtyRaw: "0" },
    SD2: { invQtyRaw: "0", incomingDateRaw: null, incomingQtyRaw: "0" },
  };
  for (const key of Object.keys(overrides) as WarehouseCode[]) {
    base[key] = { ...base[key], ...overrides[key] };
  }
  return base;
}

describe("parseCalendarDate", () => {
  it("parses US-format dates", () => {
    expect(parseCalendarDate("10/15/2026")).toEqual({ year: 2026, month: 10, day: 15 });
  });
  it("rejects invalid calendar dates", () => {
    expect(parseCalendarDate("13/40/2026")).toBeNull();
  });
  it("rejects ambiguous or non-date text", () => {
    expect(parseCalendarDate("October 15")).toBeNull();
  });
});

describe("selectExpectedDate", () => {
  it("selects a single eligible future date", () => {
    const result = selectExpectedDate(
      warehouses({ WDC: { incomingDateRaw: "10/15/2026", incomingQtyRaw: "20" } }),
      RUN_DATE,
    );
    expect(result.date).toBe("10/15/2026");
    expect(result.sources).toEqual(["WDC"]);
    expect(result.conflict).toBe(false);
  });

  it("picks the earliest of two different future dates and flags a conflict", () => {
    const result = selectExpectedDate(
      warehouses({
        WDC: { incomingDateRaw: "10/20/2026", incomingQtyRaw: "10" },
        SD3: { incomingDateRaw: "10/05/2026", incomingQtyRaw: "5" },
      }),
      RUN_DATE,
    );
    expect(result.date).toBe("10/05/2026");
    expect(result.sources).toEqual(["SD3"]);
    expect(result.conflict).toBe(true);
    expect(result.warnings).toContain("EXPECTED_DATE_CONFLICT");
  });

  it("retains all tied sources for the same earliest date without a conflict", () => {
    const result = selectExpectedDate(
      warehouses({
        WDC: { incomingDateRaw: "10/10/2026", incomingQtyRaw: "10" },
        SD3: { incomingDateRaw: "10/10/2026", incomingQtyRaw: "5" },
      }),
      RUN_DATE,
    );
    expect(result.date).toBe("10/10/2026");
    expect(result.sources).toEqual(["WDC", "SD3"]);
    expect(result.conflict).toBe(false);
  });

  it("warns and ignores a date paired with zero incoming quantity", () => {
    const result = selectExpectedDate(
      warehouses({ WDC: { incomingDateRaw: "10/11/2026", incomingQtyRaw: "0" } }),
      RUN_DATE,
    );
    expect(result.date).toBeNull();
    expect(result.warnings).toContain("DATE_WITH_NONPOSITIVE_INCOMING_QTY");
  });

  it("warns on a positive incoming quantity without a date", () => {
    const result = selectExpectedDate(
      warehouses({ WDC: { incomingDateRaw: null, incomingQtyRaw: "5" } }),
      RUN_DATE,
    );
    expect(result.date).toBeNull();
    expect(result.warnings).toContain("INCOMING_QTY_WITHOUT_DATE");
  });

  it("silently excludes a past or run-date date without warning", () => {
    const result = selectExpectedDate(
      warehouses({
        WDC: { incomingDateRaw: "09/17/2026", incomingQtyRaw: "5" },
        SD3: { incomingDateRaw: "09/18/2026", incomingQtyRaw: "5" },
      }),
      RUN_DATE,
    );
    expect(result.date).toBeNull();
    expect(result.warnings).toEqual([]);
  });
});
