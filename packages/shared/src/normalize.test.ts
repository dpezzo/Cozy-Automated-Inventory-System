import { describe, it, expect } from "vitest";
import { normalizeUpc, isBrandAllowed } from "./normalize";

describe("normalizeUpc", () => {
  it("preserves leading zeros", () => {
    const result = normalizeUpc("000000000004");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("000000000004");
  });

  it("flags blank as invalid", () => {
    const result = normalizeUpc("");
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("BLANK_UPC");
  });

  it("flags null as invalid", () => {
    const result = normalizeUpc(null);
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("BLANK_UPC");
  });

  it("flags nonnumeric text as invalid", () => {
    const result = normalizeUpc("ABC123");
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("NONNUMERIC_UPC");
  });

  it("strips a numeric-coercion terminal .0", () => {
    const result = normalizeUpc("123456.0");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("123456");
  });

  it("rejects scientific notation", () => {
    const result = normalizeUpc("1.23E+11");
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("NONNUMERIC_UPC");
  });

  it("trims surrounding whitespace", () => {
    const result = normalizeUpc("  000123  ");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("000123");
  });

  it("does not pad or strip internal digits", () => {
    const result = normalizeUpc("00");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("00");
  });
});

describe("isBrandAllowed", () => {
  const allowlist = ["Beautyrest", "Serta", "True North by Sleep Philosophy", "Woolrich", "Sharper Image"];

  it("matches case-insensitively after trimming", () => {
    expect(isBrandAllowed("  serta  ", allowlist)).toBe(true);
    expect(isBrandAllowed("SERTA", allowlist)).toBe(true);
  });

  it("rejects unknown brands", () => {
    expect(isBrandAllowed("Unapproved Brand", allowlist)).toBe(false);
  });

  it("rejects blank brand", () => {
    expect(isBrandAllowed("", allowlist)).toBe(false);
    expect(isBrandAllowed(null, allowlist)).toBe(false);
    expect(isBrandAllowed(undefined, allowlist)).toBe(false);
  });
});
