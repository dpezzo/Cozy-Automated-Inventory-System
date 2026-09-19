import type {
  BlockerCode,
  ManagedValues,
  MatchOutcome,
  MivaRawRow,
  OlliixRawRow,
  OlliixRuleConfig,
  ReconciliationRow,
  ReviewClass,
  WarningCode,
} from "./types";
import { normalizeUpc, normalizeGtin, isBrandAllowed } from "./normalize";
import { parseTotalQty, parseWarehouseQty } from "./quantity";
import { selectExpectedDate, type ParsedCalendarDate } from "./dateRules";
import { computeProposedManagedValues, managedValuesEqual } from "./managedValues";
import { WAREHOUSE_CODES } from "./types";

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
  applicableByGtin: Map<string, MivaRawRow[]>;
  excludedByGtin: Map<string, MivaRawRow[]>;
}

function buildMivaIndex(mivaRows: MivaRawRow[], allowlist: string[]): MivaIndex {
  const applicableByGtin = new Map<string, MivaRawRow[]>();
  const excludedByGtin = new Map<string, MivaRawRow[]>();

  for (const row of mivaRows) {
    const normalized = normalizeGtin(row.gtinRaw);
    if (!normalized.valid || normalized.normalized === null) continue;
    const applicable = isBrandAllowed(row.brandRaw, allowlist);
    const target = applicable ? applicableByGtin : excludedByGtin;
    const bucket = target.get(normalized.normalized);
    if (bucket) bucket.push(row);
    else target.set(normalized.normalized, [row]);
  }

  return { applicableByGtin, excludedByGtin };
}

function resolveMiva(index: MivaIndex, normalizedUpc: string): MivaLookup {
  const applicable = index.applicableByGtin.get(normalizedUpc);
  if (applicable && applicable.length === 1) return { status: "unique", match: applicable[0]! };
  if (applicable && applicable.length > 1) return { status: "ambiguous", matches: applicable };

  const excluded = index.excludedByGtin.get(normalizedUpc);
  if (excluded && excluded.length > 0) return { status: "excluded", matches: excluded };

  return { status: "none" };
}

export interface ReconcileOptions {
  config: OlliixRuleConfig;
  runDate: ParsedCalendarDate;
}

export interface ReconcileResult {
  rows: ReconciliationRow[];
}

/**
 * Runs the full Olliix reconciliation engine over raw parsed rows and produces
 * one ReconciliationRow per Olliix vendor row plus one per Miva product that is
 * absent from the Olliix file. Pure function: no I/O, no persistence.
 */
export function reconcile(
  olliixRows: OlliixRawRow[],
  mivaRows: MivaRawRow[],
  options: ReconcileOptions,
): ReconcileResult {
  const { config, runDate } = options;
  const index = buildMivaIndex(mivaRows, config.brandAllowlist);
  const usedGtins = new Set<string>();

  // Pass 1: normalize UPCs and find vendor-side duplicates.
  const normalized = olliixRows.map((row) => ({ row, upc: normalizeUpc(row.upcRaw) }));
  const groups = new Map<string, typeof normalized>();
  for (const entry of normalized) {
    if (!entry.upc.valid || entry.upc.normalized === null) continue;
    const bucket = groups.get(entry.upc.normalized);
    if (bucket) bucket.push(entry);
    else groups.set(entry.upc.normalized, [entry]);
  }

  const results: ReconciliationRow[] = [];

  for (const entry of normalized) {
    const { row, upc } = entry;
    const totalQtyRaw = formatTotalQtyDisplay(row.totalQtyRaw);

    if (!upc.valid || upc.normalized === null) {
      results.push({
        sourceRowNumber: row.sourceRowNumber,
        itemNo: row.itemNoRaw,
        rawUpc: row.upcRaw,
        normalizedUpc: null,
        description: row.descriptionRaw,
        productCode: null,
        matchOutcome: "BLOCKED IDENTIFIER",
        reviewClass: "BLOCKED",
        warningCodes: [],
        blockerCodes: [upc.invalidReason as BlockerCode],
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

    const isDuplicateVendorKey = (groups.get(upc.normalized)?.length ?? 0) > 1;
    const lookup = resolveMiva(index, upc.normalized);

    let productCode: string | null = null;
    let current: Partial<ManagedValues> = {};
    if (lookup.status === "unique") {
      productCode = lookup.match.productCode;
      current = currentValuesFromMiva(lookup.match);
      usedGtins.add(upc.normalized);
    } else if (lookup.status === "ambiguous") {
      productCode = joinCodes(lookup.matches);
      usedGtins.add(upc.normalized);
    } else if (lookup.status === "excluded") {
      productCode = joinCodes(lookup.matches);
      if (lookup.matches.length === 1) current = currentValuesFromMiva(lookup.matches[0]!);
    }

    if (isDuplicateVendorKey) {
      results.push({
        sourceRowNumber: row.sourceRowNumber,
        itemNo: row.itemNoRaw,
        rawUpc: row.upcRaw,
        normalizedUpc: upc.normalized,
        description: row.descriptionRaw,
        productCode,
        matchOutcome: "BLOCKED DUPLICATE VENDOR KEY",
        reviewClass: "BLOCKED",
        warningCodes: [],
        blockerCodes: ["DUPLICATE_VENDOR_UPC"],
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
        rawUpc: row.upcRaw,
        normalizedUpc: upc.normalized,
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
        rawUpc: row.upcRaw,
        normalizedUpc: upc.normalized,
        description: row.descriptionRaw,
        productCode,
        matchOutcome: "BLOCKED AMBIGUOUS MIVA KEY",
        reviewClass: "BLOCKED",
        warningCodes: [],
        blockerCodes: ["DUPLICATE_MIVA_GTIN"],
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
        rawUpc: row.upcRaw,
        normalizedUpc: upc.normalized,
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
    const componentQtys = WAREHOUSE_CODES.map((code) => parseWarehouseQty(row.warehouses[code].invQtyRaw));
    if (componentQtys.every((q) => q !== null)) {
      const sum = componentQtys.reduce((acc, q) => acc + (q as number), 0);
      if (sum !== totalQty.value) warnings.push("WAREHOUSE_TOTAL_MISMATCH");
    }

    const dateResult = selectExpectedDate(row.warehouses, runDate);
    warnings.push(...dateResult.warnings);

    const proposed = computeProposedManagedValues(status, status === "SOLD OUT" ? dateResult.date : null);
    const changed = !managedValuesEqual(current, proposed);

    let reviewClass: ReviewClass;
    if (!changed) reviewClass = "UNCHANGED";
    else if (warnings.length > 0) reviewClass = "WARNING";
    else reviewClass = "CLEAN";

    results.push({
      sourceRowNumber: row.sourceRowNumber,
      itemNo: row.itemNoRaw,
      rawUpc: row.upcRaw,
      normalizedUpc: upc.normalized,
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
  // successful or ambiguous Olliix match are MISSING - REVIEW REQUIRED.
  const seenMissingGtins = new Set<string>();
  for (const row of mivaRows) {
    const normalized = normalizeGtin(row.gtinRaw);
    if (!normalized.valid || normalized.normalized === null) continue;
    if (!isBrandAllowed(row.brandRaw, config.brandAllowlist)) continue;
    if (usedGtins.has(normalized.normalized)) continue;
    seenMissingGtins.add(`${normalized.normalized}:${row.productCode}`);
  }

  for (const row of mivaRows) {
    const normalized = normalizeGtin(row.gtinRaw);
    if (!normalized.valid || normalized.normalized === null) continue;
    const key = `${normalized.normalized}:${row.productCode}`;
    if (!seenMissingGtins.has(key)) continue;

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
      rawUpc: row.gtinRaw,
      normalizedUpc: normalized.normalized,
      description: null,
      productCode: row.productCode,
      matchOutcome: "MISSING - REVIEW REQUIRED",
      reviewClass: alreadyDiscontinued ? "UNCHANGED" : "BLOCKED",
      warningCodes: [],
      blockerCodes: alreadyDiscontinued ? [] : ["MISSING_FROM_OLLIIX"],
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
