/**
 * The autopilot safety brake: a pure check that decides whether a run looks
 * normal enough for a machine to handle on its own, or should wait for a person.
 *
 * Everything is measured against the products WE CARRY (rows that matched a Miva
 * product, plus Miva products the file no longer lists) -- never against the
 * vendor's whole file. Olliix sends roughly 6,000 rows a day that are not in
 * Miva at all; those must never trip the brake.
 */
export interface BrakeLimits {
  /** Hold when the file has fewer rows than this fraction of the previous file's row count. */
  minRowRatio: number;
  /** Hold when more than this percent of carried products would change. */
  maxChangedPercent: number;
  /** Hold when more than this many products would be set to No Longer Available. */
  maxNlaProposals: number;
  /** Hold when more than this percent of carried products are missing from the file or blocked. */
  maxMissingOrBlockedPercent: number;
}

export const DEFAULT_BRAKE_LIMITS: BrakeLimits = {
  minRowRatio: 0.8,
  maxChangedPercent: 25,
  maxNlaProposals: 25,
  maxMissingOrBlockedPercent: 5,
};

export interface BrakeInput {
  fileRowCount: number;
  /** Row count of the vendor's previous file; null when there is none to compare with. */
  previousRowCount: number | null;
  /** Matched + missing + blocked rows (everything except vendor rows not found in Miva). */
  carriedCount: number;
  changedCarriedCount: number;
  nlaProposalCount: number;
  missingOrBlockedCount: number;
}

export type BrakeReasonCode = "FILE_MUCH_SMALLER" | "TOO_MANY_CHANGES" | "TOO_MANY_NLA" | "TOO_MANY_MISSING_OR_BLOCKED";

export interface BrakeReason {
  code: BrakeReasonCode;
  message: string;
}

export interface BrakeMetrics {
  fileRowCount: number;
  previousRowCount: number | null;
  rowRatio: number | null;
  carriedCount: number;
  changedPercent: number | null;
  nlaProposalCount: number;
  missingOrBlockedPercent: number | null;
}

export interface BrakeResult {
  hold: boolean;
  reasons: BrakeReason[];
  /** The numbers behind the decision, recorded on every message so the limits can be tuned from real data. */
  metrics: BrakeMetrics;
}

function percent(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function evaluateBrake(input: BrakeInput, limits: BrakeLimits = DEFAULT_BRAKE_LIMITS): BrakeResult {
  const reasons: BrakeReason[] = [];

  const rowRatio = input.previousRowCount && input.previousRowCount > 0 ? input.fileRowCount / input.previousRowCount : null;
  if (rowRatio !== null && rowRatio < limits.minRowRatio) {
    reasons.push({
      code: "FILE_MUCH_SMALLER",
      message: `The file has ${input.fileRowCount} rows, only ${round1(rowRatio * 100)}% of the previous file's ${input.previousRowCount} (limit: at least ${round1(limits.minRowRatio * 100)}%).`,
    });
  }

  const changedPercent = percent(input.changedCarriedCount, input.carriedCount);
  if (changedPercent !== null && changedPercent > limits.maxChangedPercent) {
    reasons.push({
      code: "TOO_MANY_CHANGES",
      message: `${round1(changedPercent)}% of the products we carry would change (limit: ${limits.maxChangedPercent}%).`,
    });
  }

  if (input.nlaProposalCount > limits.maxNlaProposals) {
    reasons.push({
      code: "TOO_MANY_NLA",
      message: `${input.nlaProposalCount} products would be set to No Longer Available (limit: ${limits.maxNlaProposals}).`,
    });
  }

  const missingPercent = percent(input.missingOrBlockedCount, input.carriedCount);
  if (missingPercent !== null && missingPercent > limits.maxMissingOrBlockedPercent) {
    reasons.push({
      code: "TOO_MANY_MISSING_OR_BLOCKED",
      message: `${round1(missingPercent)}% of the products we carry are missing from the file or blocked (limit: ${limits.maxMissingOrBlockedPercent}%).`,
    });
  }

  return {
    hold: reasons.length > 0,
    reasons,
    metrics: {
      fileRowCount: input.fileRowCount,
      previousRowCount: input.previousRowCount,
      rowRatio: rowRatio === null ? null : Math.round(rowRatio * 1000) / 1000,
      carriedCount: input.carriedCount,
      changedPercent: changedPercent === null ? null : round1(changedPercent),
      nlaProposalCount: input.nlaProposalCount,
      missingOrBlockedPercent: missingPercent === null ? null : round1(missingPercent),
    },
  };
}
