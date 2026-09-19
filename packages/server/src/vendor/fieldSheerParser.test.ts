import { describe, it, expect } from "vitest";
import { parseFieldSheerWorkbook } from "./fieldSheerParser";

describe("parseFieldSheerWorkbook", () => {
  it("parses the simple 3-column SKU/Description/Qty Available file", () => {
    const buffer = Buffer.from(
      ["SKU,Description,Qty Available", "ACC0271,Dual Power 12V Y Harness,15", "FSMJ02010226,Heated Jacket,3"].join(
        "\n",
      ),
      "utf8",
    );
    const { rows } = parseFieldSheerWorkbook(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sourceRowNumber: 1,
      itemNoRaw: "ACC0271",
      upcRaw: null,
      skuRaw: "ACC0271",
      descriptionRaw: "Dual Power 12V Y Harness",
      totalQtyRaw: "15",
    });
  });

  it("rejects a file missing a required column", () => {
    const buffer = Buffer.from(["SKU,Description", "ACC0271,Dual Power 12V Y Harness"].join("\n"), "utf8");
    expect(() => parseFieldSheerWorkbook(buffer)).toThrow(/Qty Available/);
  });
});
