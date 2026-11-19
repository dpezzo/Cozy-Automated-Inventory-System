import { describe, it, expect } from "vitest";
import { evaluateBrake, DEFAULT_BRAKE_LIMITS, type BrakeInput } from "./brake";
import { parseSenderList, isSenderApproved, passesAuthentication } from "./senders";

const normal: BrakeInput = {
  fileRowCount: 6200,
  previousRowCount: 6180,
  carriedCount: 2000,
  changedCarriedCount: 60,
  nlaProposalCount: 2,
  missingOrBlockedCount: 18,
};

describe("evaluateBrake", () => {
  it("passes a normal Olliix-sized day, even though thousands of file rows are not in Miva", () => {
    const result = evaluateBrake(normal);
    expect(result.hold).toBe(false);
    expect(result.reasons).toEqual([]);
    expect(result.metrics.rowRatio).toBeCloseTo(1.003, 3);
  });

  it("holds a file under 80% of the previous row count (the Gobi 11/6 case: 797 of 1,051)", () => {
    const result = evaluateBrake({ ...normal, fileRowCount: 797, previousRowCount: 1051 });
    expect(result.hold).toBe(true);
    expect(result.reasons.map((r) => r.code)).toContain("FILE_MUCH_SMALLER");
  });

  it("does not hold a file exactly at the row-count limit", () => {
    expect(evaluateBrake({ ...normal, fileRowCount: 800, previousRowCount: 1000 }).hold).toBe(false);
  });

  it("skips the row-count check when there is no previous file", () => {
    const result = evaluateBrake({ ...normal, fileRowCount: 10, previousRowCount: null });
    expect(result.hold).toBe(false);
    expect(result.metrics.rowRatio).toBeNull();
  });

  it("holds when more than 25% of carried products would change", () => {
    const result = evaluateBrake({ ...normal, changedCarriedCount: 501 });
    expect(result.reasons.map((r) => r.code)).toEqual(["TOO_MANY_CHANGES"]);
    expect(evaluateBrake({ ...normal, changedCarriedCount: 500 }).hold).toBe(false);
  });

  it("holds when more than 25 products would go No Longer Available", () => {
    expect(evaluateBrake({ ...normal, nlaProposalCount: 26 }).reasons.map((r) => r.code)).toEqual(["TOO_MANY_NLA"]);
    expect(evaluateBrake({ ...normal, nlaProposalCount: 25 }).hold).toBe(false);
  });

  it("holds when more than 5% of carried products are missing or blocked", () => {
    expect(evaluateBrake({ ...normal, missingOrBlockedCount: 101 }).reasons.map((r) => r.code)).toEqual(["TOO_MANY_MISSING_OR_BLOCKED"]);
    expect(evaluateBrake({ ...normal, missingOrBlockedCount: 100 }).hold).toBe(false);
  });

  it("does not divide by zero when no products are carried", () => {
    const result = evaluateBrake({ ...normal, carriedCount: 0, changedCarriedCount: 0, missingOrBlockedCount: 0 });
    expect(result.hold).toBe(false);
    expect(result.metrics.changedPercent).toBeNull();
  });

  it("reports every reason at once and honors custom limits", () => {
    const result = evaluateBrake(
      { fileRowCount: 100, previousRowCount: 1000, carriedCount: 100, changedCarriedCount: 90, nlaProposalCount: 50, missingOrBlockedCount: 50 },
      DEFAULT_BRAKE_LIMITS,
    );
    expect(result.reasons).toHaveLength(4);
    expect(evaluateBrake(normal, { ...DEFAULT_BRAKE_LIMITS, maxNlaProposals: 1 }).reasons.map((r) => r.code)).toEqual(["TOO_MANY_NLA"]);
  });
});

describe("sender checks", () => {
  it("parses a comma-separated list, trimming, lower-casing and de-duplicating", () => {
    expect(parseSenderList(" Cale@Delutti.com, dpezzo@gmail.com ;cale@delutti.com\n")).toEqual(["cale@delutti.com", "dpezzo@gmail.com"]);
    expect(parseSenderList("")).toEqual([]);
    expect(parseSenderList(null)).toEqual([]);
  });

  it("matches senders case-insensitively and rejects strangers and blanks", () => {
    const approved = ["cale@delutti.com"];
    expect(isSenderApproved("CALE@delutti.com", approved)).toBe(true);
    expect(isSenderApproved("evil@example.com", approved)).toBe(false);
    expect(isSenderApproved(null, approved)).toBe(false);
  });

  it("requires a passing DMARC result in the authentication header", () => {
    expect(passesAuthentication("mx.google.com; dkim=pass; spf=pass; dmarc=pass (p=NONE)")).toBe(true);
    expect(passesAuthentication("mx.google.com; dkim=pass; spf=pass; dmarc=fail (p=NONE)")).toBe(false);
    expect(passesAuthentication("mx.google.com; spf=pass")).toBe(false);
    expect(passesAuthentication(null)).toBe(false);
    expect(passesAuthentication(["mx.google.com; dmarc=pass", "evil; dmarc=fail"])).toBe(true);
    expect(passesAuthentication(["mx.google.com; dmarc=fail", "forged; dmarc=pass"])).toBe(false);
  });
});
