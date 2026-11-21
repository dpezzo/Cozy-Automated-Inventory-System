import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseGobiWorkbook } from "./gobiParser";
import { parseGobiWorkbookV2 } from "./gobiParserV2";
import { listParserVersions, parseWithVersions } from "./parserVersions";

const VENDORS = path.resolve(__dirname, "../../../../../Vendors");
// New layout (Gobi, 2026-11-06 onward): Product ID / UPC / QTY Available.
const NEW_LAYOUT = readFileSync(path.join(VENDORS, "Inventory_Report_20261121.xlsx"));
// Old layout (2026-10-24 to 2026-11-05): GOBI SKU / Ordering SKU.
const OLD_LAYOUT = readFileSync(path.join(VENDORS, "Inventory_Report_20261024.xlsx"));
// A different vendor's file (Olliix dealer inventory).
const OTHER_VENDOR = readFileSync(path.join(VENDORS, "Dealer_Inventory_202611190901032252.xlsx"));

describe("parseGobiWorkbookV2", () => {
  it("reads the 2026-11-21 file: Product ID is both item number and SKU, UPC is not carried", async () => {
    const { rows } = await parseGobiWorkbookV2(NEW_LAYOUT);
    expect(rows).toHaveLength(797);
    expect(rows[0]).toMatchObject({
      itemNoRaw: "4X15-ICEBAG",
      skuRaw: "4X15-ICEBAG",
      upcRaw: null,
      totalQtyRaw: "972",
      productPhaseRaw: "Active",
    });
    expect(rows.every((r) => (r.skuRaw ?? "").trim() !== "")).toBe(true);
  });

  it("rejects the old layout, which has no Product ID column", async () => {
    await expect(parseGobiWorkbookV2(OLD_LAYOUT)).rejects.toMatchObject({ code: "REQUIRED_COLUMNS_MISSING" });
  });

  it("is rejected by v1, so a file only ever fits one version", async () => {
    await expect(parseGobiWorkbook(NEW_LAYOUT)).rejects.toMatchObject({ code: "REQUIRED_COLUMNS_MISSING" });
    await expect(parseGobiWorkbook(OLD_LAYOUT)).resolves.toBeDefined();
  });
});

describe("listParserVersions", () => {
  it("lists two versions for Gobi and none for single-parser vendors", () => {
    expect(listParserVersions("gobi").map((v) => v.version)).toEqual(["v1", "v2"]);
    expect(listParserVersions("olliix")).toEqual([]);
    expect(listParserVersions("not-a-vendor")).toEqual([]);
  });
});

describe("parseWithVersions (active first, then fallback)", () => {
  it("uses the active version when it fits, with no fallback noted", async () => {
    const r = await parseWithVersions("gobi", NEW_LAYOUT, { active: "v2" });
    expect(r.parserVersion).toBe("v2");
    expect(r.parserFellBackFrom).toBeUndefined();
    expect(r.rows).toHaveLength(797);
  });

  it("falls back to v1 when the active v2 rejects an old-layout file, and says so", async () => {
    const r = await parseWithVersions("gobi", OLD_LAYOUT, { active: "v2" });
    expect(r.parserVersion).toBe("v1");
    expect(r.parserFellBackFrom).toBe("v2");
  });

  it("falls back to v2 when the active v1 rejects a new-layout file", async () => {
    const r = await parseWithVersions("gobi", NEW_LAYOUT, { active: "v1" });
    expect(r.parserVersion).toBe("v2");
    expect(r.parserFellBackFrom).toBe("v1");
  });

  it("uses the vendor default when no version is active, and ignores an unknown one", async () => {
    expect((await parseWithVersions("gobi", NEW_LAYOUT, { active: null })).parserFellBackFrom).toBeUndefined();
    expect((await parseWithVersions("gobi", NEW_LAYOUT, { active: "v9" })).parserVersion).toBe("v2");
  });

  it("a forced version never falls back", async () => {
    expect((await parseWithVersions("gobi", NEW_LAYOUT, { forceVersion: "v2" })).parserVersion).toBe("v2");
    await expect(parseWithVersions("gobi", NEW_LAYOUT, { forceVersion: "v1" })).rejects.toMatchObject({ code: "REQUIRED_COLUMNS_MISSING" });
    await expect(parseWithVersions("gobi", OLD_LAYOUT, { forceVersion: "v2" })).rejects.toMatchObject({ code: "REQUIRED_COLUMNS_MISSING" });
    await expect(parseWithVersions("gobi", NEW_LAYOUT, { forceVersion: "v9" })).rejects.toMatchObject({ code: "PARSER_VERSION_UNKNOWN" });
  });

  it("when every version rejects the file, keeps the first error's code and lists the other attempts", async () => {
    const err = await parseWithVersions("gobi", OTHER_VENDOR, { active: "v2" }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBeDefined();
    expect(err.message).toContain("Also tried");
    expect(err.message).toContain("v1:");
  });
});
