import { describe, it, expect } from "vitest";
import { parseCatalogViewConfig, EMPTY_CATALOG_VIEW_CONFIG, BUILTIN_CATALOG_VIEWS, isBuiltinCatalogViewId } from "./catalogView";

describe("parseCatalogViewConfig", () => {
  it("accepts the empty config and every built-in view", () => {
    expect(parseCatalogViewConfig(EMPTY_CATALOG_VIEW_CONFIG)).toEqual(EMPTY_CATALOG_VIEW_CONFIG);
    for (const view of BUILTIN_CATALOG_VIEWS) expect(parseCatalogViewConfig(view.config)).not.toBeNull();
  });

  it("keeps a full config intact and drops unknown properties", () => {
    const input = {
      ...EMPTY_CATALOG_VIEW_CONFIG,
      hiddenColumns: ["thumbnail"],
      columnOrder: ["brand", "vendor"],
      columnWidths: { brand: 150.4 },
      columnFilters: { vendor: ["Olliix"], active: ["Yes"] },
      sortKey: "brand",
      sortDir: "desc" as const,
      vendorBrandsOnly: false,
      somethingElse: "ignored",
    };
    const parsed = parseCatalogViewConfig(input)!;
    expect(parsed).not.toHaveProperty("somethingElse");
    expect(parsed.columnWidths).toEqual({ brand: 150 });
    expect(parsed.columnFilters).toEqual({ vendor: ["Olliix"], active: ["Yes"] });
    expect(parsed.sortDir).toBe("desc");
  });

  it.each([
    ["not an object", "nope"],
    ["null", null],
    ["a future version", { ...EMPTY_CATALOG_VIEW_CONFIG, version: 2 }],
    ["non-string hidden column", { ...EMPTY_CATALOG_VIEW_CONFIG, hiddenColumns: [1] }],
    ["negative width", { ...EMPTY_CATALOG_VIEW_CONFIG, columnWidths: { a: -1 } }],
    ["huge width", { ...EMPTY_CATALOG_VIEW_CONFIG, columnWidths: { a: 99999 } }],
    ["filter values not an array", { ...EMPTY_CATALOG_VIEW_CONFIG, columnFilters: { a: "x" } }],
    ["bad sort direction", { ...EMPTY_CATALOG_VIEW_CONFIG, sortDir: "up" }],
    ["missing brand switch", { ...EMPTY_CATALOG_VIEW_CONFIG, vendorBrandsOnly: undefined }],
    ["too many columns", { ...EMPTY_CATALOG_VIEW_CONFIG, hiddenColumns: Array.from({ length: 201 }, (_, i) => `c${i}`) }],
  ])("rejects %s", (_name, input) => {
    expect(parseCatalogViewConfig(input)).toBeNull();
  });

  it("recognizes built-in view ids only", () => {
    expect(isBuiltinCatalogViewId("builtin:all")).toBe(true);
    expect(isBuiltinCatalogViewId("builtin:nope")).toBe(false);
    expect(isBuiltinCatalogViewId("3f9c-real-uuid")).toBe(false);
  });
});
