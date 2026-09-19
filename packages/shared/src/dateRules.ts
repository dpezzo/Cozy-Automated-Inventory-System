import type { WarehouseCode, WarehouseEvidence, WarningCode, ExpectedDateResult } from "./types";
import { parseWarehouseQty } from "./quantity";

export interface ParsedCalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDay = month === 2 && !isLeap ? 28 : DAYS_IN_MONTH[month - 1]!;
  return day >= 1 && day <= maxDay;
}

/**
 * Parses a date cell as an unambiguous calendar date. Only zero-padded-or-not
 * US MM/DD/YYYY and ISO YYYY-MM-DD are accepted; anything else (including
 * textual months, two-digit years, or already-broken spreadsheet coercions)
 * is treated as ambiguous/invalid per rule contract section 7.
 */
export function parseCalendarDate(raw: string | null | undefined): ParsedCalendarDate | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const us = US_DATE.exec(trimmed);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = Number(us[3]);
    return isValidCalendarDate(year, month, day) ? { year, month, day } : null;
  }

  const iso = ISO_DATE.exec(trimmed);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return isValidCalendarDate(year, month, day) ? { year, month, day } : null;
  }

  return null;
}

export function formatCalendarDate(date: ParsedCalendarDate): string {
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `${mm}/${dd}/${date.year}`;
}

function compareDates(a: ParsedCalendarDate, b: ParsedCalendarDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function isStrictlyLater(candidate: ParsedCalendarDate, runDate: ParsedCalendarDate): boolean {
  return compareDates(candidate, runDate) > 0;
}

interface WarehouseDateEvaluation {
  warehouse: WarehouseCode;
  eligibleDate: ParsedCalendarDate | null;
  warnings: WarningCode[];
}

/** Evaluates one warehouse's (incomingDate, incomingQty) pair per rule contract section 7. */
export function evaluateWarehouseDate(
  warehouse: WarehouseCode,
  evidence: WarehouseEvidence,
  runDate: ParsedCalendarDate,
): WarehouseDateEvaluation {
  const dateRaw = evidence.incomingDateRaw;
  const qtyRaw = evidence.incomingQtyRaw;
  const hasDateText = dateRaw !== null && dateRaw.trim() !== "";
  const parsedDate = parseCalendarDate(dateRaw);
  const qty = parseWarehouseQty(qtyRaw);
  const hasPositiveQty = qty !== null && qty > 0;
  const warnings: WarningCode[] = [];

  if (hasDateText && parsedDate === null) {
    warnings.push("AMBIGUOUS_INCOMING_DATE");
    return { warehouse, eligibleDate: null, warnings };
  }

  if (parsedDate !== null && !hasPositiveQty) {
    warnings.push("DATE_WITH_NONPOSITIVE_INCOMING_QTY");
    return { warehouse, eligibleDate: null, warnings };
  }

  if (parsedDate === null && hasPositiveQty) {
    warnings.push("INCOMING_QTY_WITHOUT_DATE");
    return { warehouse, eligibleDate: null, warnings };
  }

  if (parsedDate !== null && hasPositiveQty) {
    if (isStrictlyLater(parsedDate, runDate)) {
      return { warehouse, eligibleDate: parsedDate, warnings };
    }
    // Valid pair, but not strictly later than the run date: silently not eligible.
    return { warehouse, eligibleDate: null, warnings };
  }

  // Neither a date nor a positive quantity: nothing to evaluate.
  return { warehouse, eligibleDate: null, warnings };
}

export interface DateEvaluationResult extends ExpectedDateResult {
  warnings: WarningCode[];
}

/**
 * Selects the earliest eligible future restock date across all of a vendor's
 * configured warehouses/locations, retaining tied sources and flagging a
 * conflict when eligible dates differ. Iterates whatever keys are actually
 * present in `warehouses` -- not a fixed list -- so it works unchanged for
 * any vendor's own set of locations (today, only Olliix populates this at
 * all; every other vendor has no incoming-date concept and simply omits
 * `warehouses` entirely, which callers must handle before calling this).
 */
export function selectExpectedDate(
  warehouses: Record<WarehouseCode, WarehouseEvidence>,
  runDate: ParsedCalendarDate,
): DateEvaluationResult {
  const warnings: WarningCode[] = [];
  const eligible: { warehouse: WarehouseCode; date: ParsedCalendarDate }[] = [];

  for (const code of Object.keys(warehouses)) {
    const evaluation = evaluateWarehouseDate(code, warehouses[code]!, runDate);
    warnings.push(...evaluation.warnings);
    if (evaluation.eligibleDate) {
      eligible.push({ warehouse: code, date: evaluation.eligibleDate });
    }
  }

  if (eligible.length === 0) {
    return { date: null, sources: [], conflict: false, warnings };
  }

  let earliest = eligible[0]!.date;
  for (const entry of eligible) {
    if (compareDates(entry.date, earliest) < 0) earliest = entry.date;
  }

  const tiedSources = eligible
    .filter((entry) => compareDates(entry.date, earliest) === 0)
    .map((entry) => entry.warehouse);

  const distinctDates = new Set(eligible.map((entry) => formatCalendarDate(entry.date)));
  const conflict = distinctDates.size > 1;
  if (conflict) warnings.push("EXPECTED_DATE_CONFLICT");

  return {
    date: formatCalendarDate(earliest),
    sources: tiedSources,
    conflict,
    warnings,
  };
}
