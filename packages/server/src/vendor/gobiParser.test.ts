import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseGobiWorkbook } from "./gobiParser";

// The real Gobi sample file (not a synthetic fixture -- no official bake-off
// fixture bundle exists for this vendor). Lives in the repo-root Vendors/
// folder, outside the app workspace.
const GOBI_FILE = path.resolve(__dirname, "../../../../../Vendors/Gobi_daily_inventory.xlsx");

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
