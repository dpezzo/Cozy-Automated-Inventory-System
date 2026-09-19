export type TotalQtyResult =
  | { kind: "blank" }
  | { kind: "invalid" }
  | { kind: "negative"; value: number }
  | { kind: "valid"; value: number };

const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;

/** Parses the Olliix Total Inventory Quantity per rule contract section 6. */
export function parseTotalQty(raw: string | null | undefined): TotalQtyResult {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { kind: "blank" };
  }
  const trimmed = raw.trim();
  if (!NUMERIC_PATTERN.test(trimmed)) {
    return { kind: "invalid" };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { kind: "invalid" };
  }
  if (value < 0) {
    return { kind: "negative", value };
  }
  return { kind: "valid", value };
}

/** Parses a warehouse inventory/incoming quantity cell. Returns null when not a valid nonnegative-or-zero number. */
export function parseWarehouseQty(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const trimmed = raw.trim();
  if (!NUMERIC_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
