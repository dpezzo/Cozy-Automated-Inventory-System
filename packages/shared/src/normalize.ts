import type { NormalizedIdentifier } from "./types";

const TERMINAL_DOT_ZERO = /^(\d+)\.0$/;
const DIGITS_ONLY = /^\d+$/;
const SCIENTIFIC_NOTATION = /^-?\d+(\.\d+)?[eE][+-]?\d+$/;

/**
 * Normalizes an Olliix UPC or Miva GTIN per Olliix_MVP_Rule_Contract.md section 3:
 * trim, strip a numeric-coercion-produced terminal ".0", require digits-only,
 * preserve leading zeros, and reject scientific notation.
 */
export function normalizeIdentifier(
  raw: string | null | undefined,
  blankReason: "BLANK_UPC" | "BLANK_GTIN",
  nonNumericReason: "NONNUMERIC_UPC" | "NONNUMERIC_GTIN",
): NormalizedIdentifier {
  const rawValue = raw ?? null;
  if (rawValue === null || rawValue.trim() === "") {
    return { raw: rawValue, normalized: null, valid: false, invalidReason: blankReason };
  }

  const trimmed = rawValue.trim();

  if (SCIENTIFIC_NOTATION.test(trimmed)) {
    // The original value cannot be losslessly recovered from scientific notation.
    return { raw: rawValue, normalized: null, valid: false, invalidReason: nonNumericReason };
  }

  const dotZeroMatch = TERMINAL_DOT_ZERO.exec(trimmed);
  const candidate = dotZeroMatch ? dotZeroMatch[1]! : trimmed;

  if (!DIGITS_ONLY.test(candidate)) {
    return { raw: rawValue, normalized: null, valid: false, invalidReason: nonNumericReason };
  }

  return { raw: rawValue, normalized: candidate, valid: true };
}

export function normalizeUpc(raw: string | null | undefined): NormalizedIdentifier {
  return normalizeIdentifier(raw, "BLANK_UPC", "NONNUMERIC_UPC");
}

export function normalizeGtin(raw: string | null | undefined): NormalizedIdentifier {
  return normalizeIdentifier(raw, "BLANK_GTIN", "NONNUMERIC_GTIN");
}

/**
 * Normalizes a vendor SKU / Miva MPN for sku-to-mpn-matched vendors (Gobi,
 * FieldSheer/MobileWarming). Unlike UPC/GTIN, a SKU is legitimately
 * alphanumeric (e.g. "AR-BR-L"), so this only trims and blank-checks --
 * there is no "must be digits-only" requirement.
 */
export function normalizeSku(raw: string | null | undefined): NormalizedIdentifier {
  const rawValue = raw ?? null;
  const trimmed = rawValue?.trim() ?? "";
  if (trimmed === "") {
    return { raw: rawValue, normalized: null, valid: false, invalidReason: "BLANK_VENDOR_SKU" };
  }
  return { raw: rawValue, normalized: trimmed.toUpperCase(), valid: true };
}

export function normalizeBrand(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

export function isBrandAllowed(brand: string | null | undefined, allowlist: string[]): boolean {
  const trimmed = normalizeBrand(brand);
  if (trimmed === "") return false;
  const lower = trimmed.toLowerCase();
  return allowlist.some((allowed) => allowed.toLowerCase() === lower);
}
