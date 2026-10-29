/**
 * A saved Catalog "view": which columns show, in what order and width, which
 * column filters and sort are applied, and the "Vendor brands only" switch.
 * Stored as JSON in the database, so it is validated on the way in and on the
 * way out -- a hand-edited or older row can never crash the Catalog page.
 *
 * `version` exists so a later change (e.g. editable columns for an edit mode)
 * can be added without breaking views saved today.
 */
export interface CatalogViewConfig {
  version: 1;
  /** Column keys that are hidden. Anything unknown to the page is ignored when applied. */
  hiddenColumns: string[];
  /** Full column order. Empty means "the page's default order". */
  columnOrder: string[];
  columnWidths: Record<string, number>;
  /** Per column: the values that stay visible. A column with no entry is unfiltered. */
  columnFilters: Record<string, string[]>;
  sortKey: string | null;
  sortDir: "asc" | "desc";
  vendorBrandsOnly: boolean;
}

export const EMPTY_CATALOG_VIEW_CONFIG: CatalogViewConfig = {
  version: 1,
  hiddenColumns: [],
  columnOrder: [],
  columnWidths: {},
  columnFilters: {},
  sortKey: null,
  sortDir: "asc",
  vendorBrandsOnly: true,
};

/**
 * Views that ship with the app and cannot be edited or deleted. Add more here
 * later (e.g. an "Inventory check" column set) and every user gets them
 * without a migration; ids are stable strings, never reused.
 */
export const BUILTIN_CATALOG_VIEWS: { id: string; name: string; config: CatalogViewConfig }[] = [
  { id: "builtin:all", name: "All columns", config: EMPTY_CATALOG_VIEW_CONFIG },
];

export function isBuiltinCatalogViewId(id: string): boolean {
  return BUILTIN_CATALOG_VIEWS.some((v) => v.id === id);
}

const MAX_KEYS = 200;
const MAX_FILTER_VALUES = 5000;

function stringArray(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  return value.every((v) => typeof v === "string") ? (value as string[]) : null;
}

/** Returns a clean config, or null if the input is not a usable one. Extra properties are dropped, never trusted. */
export function parseCatalogViewConfig(input: unknown): CatalogViewConfig | null {
  if (typeof input !== "object" || input === null) return null;
  const o = input as Record<string, unknown>;
  if (o.version !== 1) return null;

  const hiddenColumns = stringArray(o.hiddenColumns, MAX_KEYS);
  const columnOrder = stringArray(o.columnOrder, MAX_KEYS);
  if (hiddenColumns === null || columnOrder === null) return null;

  const columnWidths: Record<string, number> = {};
  if (typeof o.columnWidths !== "object" || o.columnWidths === null) return null;
  for (const [key, width] of Object.entries(o.columnWidths as Record<string, unknown>)) {
    if (typeof width !== "number" || !Number.isFinite(width) || width <= 0 || width > 5000) return null;
    columnWidths[key] = Math.round(width);
  }

  const columnFilters: Record<string, string[]> = {};
  if (typeof o.columnFilters !== "object" || o.columnFilters === null) return null;
  for (const [key, values] of Object.entries(o.columnFilters as Record<string, unknown>)) {
    const list = stringArray(values, MAX_FILTER_VALUES);
    if (list === null) return null;
    columnFilters[key] = list;
  }

  if (o.sortKey !== null && typeof o.sortKey !== "string") return null;
  if (o.sortDir !== "asc" && o.sortDir !== "desc") return null;
  if (typeof o.vendorBrandsOnly !== "boolean") return null;

  return {
    version: 1,
    hiddenColumns,
    columnOrder,
    columnWidths,
    columnFilters,
    sortKey: o.sortKey as string | null,
    sortDir: o.sortDir,
    vendorBrandsOnly: o.vendorBrandsOnly,
  };
}
