import { describe, it, expect } from "vitest";
import { parseTotalQty } from "./quantity";

describe("parseTotalQty", () => {
  it("treats blank as blank", () => {
    expect(parseTotalQty("").kind).toBe("blank");
    expect(parseTotalQty(null).kind).toBe("blank");
    expect(parseTotalQty("   ").kind).toBe("blank");
  });

  it("treats nonnumeric text as invalid", () => {
    expect(parseTotalQty("N/A").kind).toBe("invalid");
  });

  it("treats negative numbers as negative", () => {
    const r = parseTotalQty("-1");
    expect(r.kind).toBe("negative");
    if (r.kind === "negative") expect(r.value).toBe(-1);
  });

  it("treats zero as valid", () => {
    const r = parseTotalQty("0");
    expect(r.kind).toBe("valid");
    if (r.kind === "valid") expect(r.value).toBe(0);
  });

  it("treats positive integers as valid", () => {
    const r = parseTotalQty("6");
    expect(r.kind).toBe("valid");
    if (r.kind === "valid") expect(r.value).toBe(6);
  });
});
