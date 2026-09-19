import type {
  BlockerCode,
  ManagedValues,
  MatchOutcome,
  MivaRawRow,
  NormalizedIdentifier,
  VendorRawRow,
  VendorRuleConfig,
  ReconciliationRow,
  ReviewClass,
  WarningCode,
} from "./types";
import { normalizeUpc, normalizeGtin, normalizeSku, isBrandAllowed } from "./normalize";
import { parseTotalQty, parseWarehouseQty } from "./quantity";
import { selectExpectedDate, type ParsedCalendarDate } from "./dateRules";
import { computeProposedManagedValues, managedValuesEqual } from "./managedValues";

function formatTotalQtyDisplay(raw: string | null): string | null {
  return raw;
}

function currentValuesFromMiva(row: MivaRawRow): Partial<ManagedValues> {
  return {
    simpleInventory: row.currentSimpleInventory,
    availability: row.currentAvailability,
    restockMessage: row.currentRestockMessage,
    dataFeed: row.currentDataFeed,
    shoppingFeed: row.currentShoppingFeed,
    reportFlag: row.currentReportFlag,
  };
}

function joinCodes(rows: MivaRawRow[]): string {
  return rows
    .map((r) => r.productCode)
    .sort((a, b) => a.localeCompare(b))
    .join("|");
}

type MivaLookup =
  | { status: "none" }
  | { status: "unique"; match: MivaRawRow }
  | { status: "ambiguous"; matches: MivaRawRow[] }
  | { status: "excluded"; matches: MivaRawRow[] };

interface MivaIndex {
  applicableByKey: Map<string, MivaRawRow[]>;
  excludedByKey: Map<string, MivaRawRow[]>;
}

/**
 * Indexes Miva rows by whichever identifier this vendor matches on (GTIN for
 * upc-to-gtin vendors, MPN for sku-to-mpn vendors), split into brand-eligible
 * ("applicable") vs not, per the vendor's brandAllowlist.
 */
function buildMivaIndex(
  mivaRows: MivaRawRow[],
  allowlist: string[],
  getIdentifierRaw: (row: MivaRawRow) => string | null,
  normalizeFn: (raw: string | null | undefined) => NormalizedIdentifier,
): MivaIndex {
  const applicableByKey = new Map<string, MivaRawRow[]>();
  const excludedByKey = new Map<string, MivaRawRow[]>();

  for (const row of mivaRows) {
    const normalized = normalizeFn(getIdentifierRaw(row));
    if (!normalized.valid || normalized.normalized === null) continue;
    const applicable = isBrandAllowed(row.brandRaw, allowlist);
    const target = applicable ? applicableByKey : excludedByKey;
    const bucket = target.get(normalized.normalized);
    if (bucket) bucket.push(row);
    else target.set(normalized.normalized, [row]);
  }

  return { applicableByKey, excludedByKey };
}

function resolveMiva(index: MivaIndex, normalizedKey: string): MivaLookup {
  const applicable = index.applicableByKey.get(normalizedKey);
  if (applicable && applicable.length === 1) return { status: "unique", match: applicable[0]! };
  if (applicable && applicable.length > 1) return { status: "ambiguous", matches: applicable };

  const excluded = index.excludedByKey.get(normalizedKey);
  if (excluded && excluded.length > 0) return { status: "excluded", matches: excluded };

  return { status: "none" };
}

export interface ReconcileOptions {
  config: VendorRuleConfig;
  runDate: ParsedCalendarDate;
}

export interface ReconcileResult {
  rows: ReconciliationRow[];
}

/**
 * Runs the full reconciliation engine over one vendor's raw parsed rows and
 * produces one ReconciliationRow per vendor row plus one per Miva product
 * that is absent from the vendor file. Pure function: no I/O, no
 * persistence. Matching is strategy-driven (config.matchStrategy): barcode
 * vendors (Olliix, K&H) match UPC-to-GTIN; SKU vendors (Gobi,
 * FieldSheer/MobileWarming) match SKU-to-MPN. Everything else (quantity
 * threshold, managed-value diffing, review-class assignment) is identical
 * regardless of vendor.
 */
export function reconcile(vendorRows: VendorRawRow[], mivaRows: MivaRawRow[], options: ReconcileOptions): ReconcileResult {
  const { config, runDate } = options;
  const isSkuVendor = config.matchStrategy === "sku-to-mpn";

  const vendorNormalize = isSkuVendor ? normalizeSku : normalizeUpc;
  const mivaNormalize = isSkuVendor ? normalizeSku : normalizeGtin;
  const getVendorIdentifierRaw = (row: VendorRawRow): string | null => (isSkuVendor ? (row.skuRaw ?? null) : row.upcRaw);
  const getMivaIdentifierRaw = (row: MivaRawRow): string | null => (isSkuVendor ? row.mpnRaw : row.gtinRaw);
  const duplicateVendorCode: BlockerCode = isSkuVendor ? "DUPLICATE_VENDOR_SKU" : "DUPLICATE_VENDOR_UPC";
  const duplicateMivaCode: BlockerCode = isSkuVendor ? "DUPLICATE_MIVA_MPN" : "DUPLICATE_MIVA_GTIN";

  const index = buildMivaIndex(mivaRows, config.brandAllowlist, getMivaIdentifierRaw, mivaNormalize);
  const usedMivaKeys = new Set<string>();

  // Pass 1: normalize vendor identifiers and find vendor-side duplicates.
  const normalized = vendorRows.map((row) => ({ row, key: vendorNormalize(getVendorIdentifierRaw(row)) }));
  const groups = new Map<string, typeof normalized>();
  for (const entry of normalized) {
    if (!entry.key.valid || entry.key.normalized === null) continue;
    const bucket = groups.get(entry.key.normalized);
    if (bucket) bucket.push(entry);
    else groups.set(entry.key.normalized, [entry]);
  }

  const results: ReconciliationRow[] = [];

  for (const entry of normalized) {
    const { row, key } = entry;
    const totalQtyRaw = formatTotalQtyDisplay(row.totalQtyRaw);

    if (!key.valid || key.normalized === null) {
      results.push({
        sourceRowNumber: row.sourceRowNumber,
        itemNo: row.itemNoRaw,
        rawUpc: getVendorIdentifierRaw(row),
        normalizedUpc: null,
        description: row.descriptionRaw,
        productCode: null,
        matchOutcome: "BLOCKED IDENTIFIER",
        reviewClass: "BLOCKED",
        warningCodes: [],
        blockerCodes: [key.invalidReason as BlockerCode],
        totalQtyRaw,
        expectedDate: null,
        expectedDateSources: [],
        current: {},
        proposed: {},
        changed: false,
        isEligibleForApproval: false,
      });
      continue;
    }

    const isDuplicateVendorKey = (groups.get(key.normalized)?.length ?? 0) > 1;
    const lookup = resolveMiva(index, key.normalized);

    let productCode: string | null = null;
    let current: Partial<ManagedValues> = {};
    if (lookup.status === "unique") {
      productCode = lookup.match.productCode;
      current = currentValuesFromMiva(lookup.match);
      usedMivaKeys.add(key.normalized);
    } else if (lookup.status === "ambiguous") {
      productCode = joinCodes(lookup.matches);
      usedMivaKeys.add(key.normalized);
    } else if (lookup.status === "excluded") {
      productCode = joinCodes(lookup.matches);
      if (lookup.matches.length === 1) current = currentValuesFromMiva(lookup.matches[0]!);
    }

    if (isDuplicateVendorKey) {
      results.push({
        sourceRowNumber: row.sourceRowNumber,
        itemNo: row.itemNoRaw,
        rawUpc: getVendorIdentifierRaw(row),
        normalizedUpc: key.normalized,
        description: row.descriptionRaw,
        productCode,
        matchOutcome: "BLOCKED DUPLICATE VENDOR KEY",
        reviewClass: "BLOCKED",
        warningCodes: [],
        blockerCodes: [duplicateVendorCode],
        totalQtyRaw,
        expectedDate: null,
        expectedDateSources: [],
        current,
        proposed: {},
        changed: false,
        isEligibleForApproval: false,
      });
      continue;
    }

    if (lookup.status === "none" || lookup.status === "excluded") {
      const blocker: BlockerCode = lookup.status === "excluded" ? "UNKNOWN_MIVA_BRAND" : "NO_MIVA_MATCH";
      const outcome: MatchOutcome = "UNMATCHED - BRAND ELIGIBILITY UNKNOWN";
      results.push({
        sourceRowNumber: row.sourceRowNumber,
        itemNo: row.itemNoRaw,
        rawUpc: getVendorIdentifierRaw(row),
        normalizedUpc: key.normalized,
        description: row.descriptionRaw,
        productCode,
        matchOutcome: outcome,
        reviewClass: "BLOCKED",
        warningCodes: [],
        blockerCodes: [blocker],
        totalQtyRaw,
        expectedDate: null,
        expectedDateSources: [],
        current,
        proposed: {},
        changed: false,
        isEligibleForApproval: false,
      });
      continue;
    }

    if (lookup.status === "ambiguous") {
      results.push({
        sourceRowNumber: row.sourceRowNumber,
        itemNo: row.itemNoRaw,
        rawUpc: getVendorIdentifierRaw(row),
        normalizedUpc: key.normalized,
        description: row.descriptionRaw,
        productCode,
        matchOutcome: "BLOCKED AMBIGUOUS MIVA KEY",
        reviewClass: "BLOCKED",
        warningCodes: [],
        blockerCodes: [duplicateMivaCode],
        totalQtyRaw,
        expectedDate: null,
        expectedDateSources: [],
        current: {},
        proposed: {},
        changed: false,
        isEligibleForApproval: false,
      });
      continue;
    }

    // lookup.status === "unique": a genuine match. Apply quantity + date rules.
    const totalQty = parseTotalQty(row.totalQtyRaw);
    if (totalQty.kind !== "valid") {
      const blocker: BlockerCode =
        totalQty.kind === "blank"
          ? "BLANK_TOTAL_QTY"
          : totalQty.kind === "negative"
            ? "NEGATIVE_TOTAL_QTY"
            : "INVALID_TOTAL_QTY";
      results.push({
        sourceRowNumber: row.sourceRowNumber,
        itemNo: row.itemNoRaw,
        rawUpc: getVendorIdentifierRaw(row),
        normalizedUpc: key.normalized,
        description: row.descriptionRaw,
        productCode,
        matchOutcome: "MATCHED",
        reviewClass: "BLOCKED",
        warningCodes: [],
        blockerCodes: [blocker],
        totalQtyRaw,
        expectedDate: null,
        expectedDateSources: [],
        current,
        proposed: {},
        changed: false,
        isEligibleForApproval: false,
      });
      continue;
    }

    const status: "IN STOCK" | "SOLD OUT" = totalQty.value >= config.inStockThreshold ? "IN STOCK" : "SOLD OUT";

    const warnings: WarningCode[] = [];
    let dateResult: { date: string | null; sources: string[]; conflict: boolean } = { date: null, sources: [], conflict: false };

    // Only vendors with a per-location incoming-date breakdown (Olliix today)
    // carry `warehouses` at all; every other vendor omits it and simply gets
    // no expected date / no warehouse-mismatch check, rather than an error.
    if (row.warehouses) {
      const componentQtys = Object.values(row.warehouses).map((w) => parseWarehouseQty(w.invQtyRaw));
      if (componentQtys.every((q) => q !== null)) {
        const sum = componentQtys.reduce((acc, q) => acc + (q as number), 0);
        if (sum !== totalQty.value) warnings.push("WAREHOUSE_TOTAL_MISMATCH");
      }

      const evaluated = selectExpectedDate(row.warehouses, runDate);
      dateResult = evaluated;
      warnings.push(...evaluated.warnings);
    }

    const proposed = computeProposedManagedValues(status, status === "SOLD OUT" ? dateResult.date : null);
    const changed = !managedValuesEqual(current, proposed);

    let reviewClass: ReviewClass;
    if (!changed) reviewClass = "UNCHANGED";
    else if (warnings.length > 0) reviewClass = "WARNING";
    else reviewClass = "CLEAN";

    results.push({
      sourceRowNumber: row.sourceRowNumber,
      itemNo: row.itemNoRaw,
      rawUpc: getVendorIdentifierRaw(row),
      normalizedUpc: key.normalized,
      description: row.descriptionRaw,
      productCode,
      matchOutcome: "MATCHED",
      reviewClass,
      warningCodes: warnings,
      blockerCodes: [],
      totalQtyRaw,
      expectedDate: status === "SOLD OUT" ? dateResult.date : null,
      expectedDateSources: status === "SOLD OUT" ? dateResult.sources : [],
      current,
      proposed,
      changed,
      isEligibleForApproval: reviewClass === "CLEAN" || reviewClass === "WARNING",
    });
  }

  // Pass 2: Miva products in the applicable population never referenced by a
  // successful or ambiguous vendor match are MISSING - REVIEW REQUIRED.
  const seenMissingKeys = new Set<string>();
  for (const row of mivaRows) {
    const normalized = mivaNormalize(getMivaIdentifierRaw(row));
    if (!normalized.valid || normalized.normalized === null) continue;
    if (!isBrandAllowed(row.brandRaw, config.brandAllowlist)) continue;
    if (usedMivaKeys.has(normalized.normalized)) continue;
    seenMissingKeys.add(`${normalized.normalized}:${row.productCode}`);
  }

  for (const row of mivaRows) {
    const normalized = mivaNormalize(getMivaIdentifierRaw(row));
    if (!normalized.valid || normalized.normalized === null) continue;
    const key = `${normalized.normalized}:${row.productCode}`;
    if (!seenMissingKeys.has(key)) continue;

    const current = currentValuesFromMiva(row);
    // If Miva already shows this product as discontinued, there is nothing
    // to propose or review: the app never *sets* NO LONGER AVAILABLE based
    // on a missing vendor occurrence (DEV-001), but recognizing an
    // already-discontinued product as unchanged -- rather than reflagging
    // it as a review-required exception on every run -- asserts no new
    // information and keeps it out of the way once someone has already
    // made that call in Miva.
    const alreadyDiscontinued = (current.simpleInventory ?? "").trim() === "NO LONGER AVAILABLE";

    results.push({
      sourceRowNumber: null,
      itemNo: null,
      rawUpc: getMivaIdentifierRaw(row),
      normalizedUpc: normalized.normalized,
      description: null,
      productCode: row.productCode,
      matchOutcome: "MISSING - REVIEW REQUIRED",
      reviewClass: alreadyDiscontinued ? "UNCHANGED" : "BLOCKED",
      warningCodes: [],
      blockerCodes: alreadyDiscontinued ? [] : [config.missingBlockerCode ?? "MISSING_FROM_VENDOR"],
      totalQtyRaw: null,
      expectedDate: null,
      expectedDateSources: [],
      current,
      proposed: alreadyDiscontinued ? current : {},
      changed: false,
      isEligibleForApproval: false,
    });
  }

  return { rows: results };
}
