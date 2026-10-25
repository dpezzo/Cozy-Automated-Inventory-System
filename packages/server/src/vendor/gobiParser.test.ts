import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseGobiWorkbook } from "./gobiParser";

// The real Gobi sample file (not a synthetic fixture -- no official bake-off
// fixture bundle exists for this vendor). Lives in the repo-root Vendors/
// folder, outside the app workspace.
const GOBI_FILE = path.resolve(__dirname, "../../../../../Vendors/Gobi_daily_inventory.xlsx");
// Gobi's revised report (2026-10-24): renamed headers/worksheet plus a Product Phase column.
const GOBI_REPORT_FILE = path.resolve(__dirname, "../../../../../Vendors/Inventory_Report_20261024.xlsx");

describe("parseGobiWorkbook", () => {
  it("parses the real Gobi Heat sample file with the documented row/exception characteristics", () => {
    if (!existsSync(GOBI_FILE)) {
      throw new Error(`Gobi sample file not found at ${GOBI_FILE}`);
    }
    const buffer = readFileSync(GOBI_FILE);
    return parseGobiWorkbook(buffer).then(({ rows }) => {
      // Per CozyWinters_Vendor_Inventory_Automation_Roadmap.md: 687 rows,
      // 56 lack an Ordering SKU, 9 participate in duplicate Ordering SKU values.
      expect(rows).toHaveLength(687);
      const blankSku = rows.filter((r) => !r.skuRaw || r.skuRaw.trim() === "").length;
      expect(blankSku).toBe(56);

      const bySku = new Map<string, number>();
      for (const r of rows) {
        const sku = (r.skuRaw ?? "").trim().toUpperCase();
        if (!sku) continue;
        bySku.set(sku, (bySku.get(sku) ?? 0) + 1);
      }
      const duplicateRowCount = [...bySku.values()].filter((count) => count > 1).reduce((a, c) => a + c, 0);
      expect(duplicateRowCount).toBe(9);
    });
  });

  it("leaves productPhaseRaw empty for the legacy format, which has no Product Phase column", async () => {
    const { rows } = await parseGobiWorkbook(readFileSync(GOBI_FILE));
    expect(rows.every((r) => r.productPhaseRaw === null || r.productPhaseRaw === undefined)).toBe(true);
  });

  it("parses the 2026-10-24 report: renamed ID/quantity headers, renamed worksheet, and the Product Phase column", async () => {
    if (!existsSync(GOBI_REPORT_FILE)) {
      throw new Error(`Gobi report file not found at ${GOBI_REPORT_FILE}`);
    }
    const { rows } = await parseGobiWorkbook(readFileSync(GOBI_REPORT_FILE));
    expect(rows).toHaveLength(1105);
    // GOBI SKU now carries the same value as Ordering SKU, so no row lacks a SKU.
    expect(rows.filter((r) => !r.skuRaw || r.skuRaw.trim() === "")).toHaveLength(0);
    expect(rows[0]!.itemNoRaw).toBe("4X15-ICEBAG");
    expect(rows[0]!.totalQtyRaw).toBe("973");

    const phases = new Map<string, number>();
    for (const r of rows) phases.set(r.productPhaseRaw ?? "", (phases.get(r.productPhaseRaw ?? "") ?? 0) + 1);
    expect(Object.fromEntries(phases)).toEqual({ Active: 820, "End of Life (EOL)": 116, Discontinued: 169 });
  });

  it("fails with a clear error when a required column cannot be recognized", async () => {
    // The real report with its quantity header renamed to something unknown would be rejected;
    // simulated here by parsing a buffer that is not a Gobi report at all.
    const buffer = readFileSync(path.resolve(__dirname, "../../../../../Vendors/Olliix_daily_inventory.xlsx"));
    await expect(parseGobiWorkbook(buffer)).rejects.toThrow();
  });

  it("treats the misspelled 'Gobo Heat ID (internal use only)' header as the internal ID column", () => {
    if (!existsSync(GOBI_FILE)) {
      throw new Error(`Gobi sample file not found at ${GOBI_FILE}`);
    }
    const buffer = readFileSync(GOBI_FILE);
    return parseGobiWorkbook(buffer).then(({ rows }) => {
      expect(rows[0]!.itemNoRaw).toBeTruthy();
    });
  });
});
