import type { ReconciliationRow } from "./types";
import { sortForReview } from "./reports";

export interface LegacyAuditRow {
  sku: string | null;
  upcRaw: string | null;
  description: string | null;
  productCode: string | null;
  expectedDateRaw: string | null;
  expectedDateSourceRaw: string | null;
  simpleInventory: string | null;
  availability: string | null;
  restockMessage: string | null;
  dataFeed: string | null;
  shoppingFeed: string | null;
  reportFlag: string | null;
}

export type LegacyComparisonClass =
  | "EXACT_MATCH"
  | "APPROVED_DEVIATION"
  | "UNEXPLAINED_DIFFERENCE"
  | "NOT_COMPARABLE";

/** Same six managed fields ReconciliationRow.current/proposed use, plus the expected date -- lets a legacy comparison row be reviewed the same way a reconciliation row is (side-by-side field values), not just as a bare pass/fail classification. */
export interface LegacyComparisonValues {
  simpleInventory: string | null;
  availability: string | null;
  restockMessage: string | null;
  dataFeed: string | null;
  shoppingFeed: string | null;
  reportFlag: string | null;
  expectedDate: string | null;
}

export interface LegacyComparisonResult {
  sourceRowNumber: number | null;
  productCode: string | null;
  itemNo: string | null;
  rawUpc: string | null;
  /** Same provenance as itemNo/rawUpc: the vendor file's description column, null for a Miva-only row not present in the vendor file. */
  itemName: string | null;
  comparisonClass: LegacyComparisonClass;
  deviationId: string | null;
  note: string;
  /** What this app calculated -- null only when the row was never reconciled to a proposal (e.g. blocked before matching). Notably null for a Miva-only row not yet marked discontinued (row.proposed is never populated for it) -- mivaValues is the only real reference point for that case. */
  ourValues: LegacyComparisonValues | null;
  /** What the legacy workbook recorded -- null when no legacy counterpart row was found. */
  legacyValues: LegacyComparisonValues | null;
  /** What Miva already had before this run -- never itself compared for the pass/fail classification below, but useful context: was a difference introduced by this run's calculation, or did Miva already disagree with the legacy file? expectedDate has no Miva-current equivalent (a purely derived/proposed concept), so it's always null here. */
  mivaValues: LegacyComparisonValues | null;
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function ourValuesFrom(row: ReconciliationRow): LegacyComparisonValues | null {
  if (Object.keys(row.proposed).length === 0) return null;
  return {
    simpleInventory: row.proposed.simpleInventory ?? null,
    availability: row.proposed.availability ?? null,
    restockMessage: row.proposed.restockMessage ?? null,
    dataFeed: row.proposed.dataFeed ?? null,
    shoppingFeed: row.proposed.shoppingFeed ?? null,
    reportFlag: row.proposed.reportFlag ?? null,
    expectedDate: row.expectedDate,
  };
}

function mivaValuesFrom(row: ReconciliationRow): LegacyComparisonValues | null {
  if (Object.keys(row.current).length === 0) return null;
  return {
    simpleInventory: row.current.simpleInventory ?? null,
    availability: row.current.availability ?? null,
    restockMessage: row.current.restockMessage ?? null,
    dataFeed: row.current.dataFeed ?? null,
    shoppingFeed: row.current.shoppingFeed ?? null,
    reportFlag: row.current.reportFlag ?? null,
    expectedDate: null,
  };
}

function legacyValuesFrom(legacy: LegacyAuditRow | undefined): LegacyComparisonValues | null {
  if (!legacy) return null;
  return {
    simpleInventory: legacy.simpleInventory,
    availability: legacy.availability,
    restockMessage: legacy.restockMessage,
    dataFeed: legacy.dataFeed,
    shoppingFeed: legacy.shoppingFeed,
    reportFlag: legacy.reportFlag,
    expectedDate: legacy.expectedDateRaw,
  };
}

function buildLegacyIndex(legacyRows: LegacyAuditRow[]) {
  const byProductCode = new Map<string, LegacyAuditRow>();
  const byItemNo = new Map<string, LegacyAuditRow>();
  const byRawUpc = new Map<string, LegacyAuditRow>();

  for (const row of legacyRows) {
    const code = norm(row.productCode);
    if (code !== "" && !byProductCode.has(code)) byProductCode.set(code, row);
    const sku = norm(row.sku);
    if (sku !== "" && !byItemNo.has(sku)) byItemNo.set(sku, row);
    const upc = norm(row.upcRaw);
    if (upc !== "" && !byRawUpc.has(upc)) byRawUpc.set(upc, row);
  }

  return { byProductCode, byItemNo, byRawUpc };
}

function findLegacyRow(
  index: ReturnType<typeof buildLegacyIndex>,
  row: ReconciliationRow,
): LegacyAuditRow | undefined {
  const code = norm(row.productCode);
  if (code !== "" && index.byProductCode.has(code)) return index.byProductCode.get(code);
  const itemNo = norm(row.itemNo);
  if (itemNo !== "" && index.byItemNo.has(itemNo)) return index.byItemNo.get(itemNo);
  const upc = norm(row.rawUpc);
  if (upc !== "" && index.byRawUpc.has(upc)) return index.byRawUpc.get(upc);
  return undefined;
}

/**
 * Compares application reconciliation results with the legacy audit export
 * per Olliix_MVP_Rule_Contract.md section 10 and MVP_CSV_Contracts.md section 7.
 */
export function compareWithLegacy(
  reconciliation: ReconciliationRow[],
  legacyRows: LegacyAuditRow[],
): LegacyComparisonResult[] {
  const index = buildLegacyIndex(legacyRows);
  const results: LegacyComparisonResult[] = [];

  for (const row of sortForReview(reconciliation)) {
    const legacy = findLegacyRow(index, row);

    if (row.blockerCodes.includes("MISSING_FROM_OLLIIX")) {
      results.push({
        sourceRowNumber: row.sourceRowNumber,
        productCode: row.productCode,
        itemNo: row.itemNo,
        rawUpc: row.rawUpc,
        itemName: row.description,
        comparisonClass: "APPROVED_DEVIATION",
        deviationId: "DEV-001",
        note: "Legacy immediate discontinuation is an approved MVP deviation",
        ourValues: ourValuesFrom(row),
        legacyValues: legacyValuesFrom(legacy),
        mivaValues: mivaValuesFrom(row),
      });
      continue;
    }

    if (row.reviewClass === "BLOCKED") {
      results.push({
        sourceRowNumber: row.sourceRowNumber,
        productCode: row.productCode,
        itemNo: row.itemNo,
        rawUpc: row.rawUpc,
        itemName: row.description,
        comparisonClass: "NOT_COMPARABLE",
        deviationId: null,
        note: "",
        ourValues: ourValuesFrom(row),
        legacyValues: legacyValuesFrom(legacy),
        mivaValues: mivaValuesFrom(row),
      });
      continue;
    }

    if (!legacy) {
      results.push({
        sourceRowNumber: row.sourceRowNumber,
        productCode: row.productCode,
        itemNo: row.itemNo,
        rawUpc: row.rawUpc,
        itemName: row.description,
        comparisonClass: "UNEXPLAINED_DIFFERENCE",
        deviationId: null,
        note: "No legacy counterpart found for a comparable row",
        ourValues: ourValuesFrom(row),
        legacyValues: null,
        mivaValues: mivaValuesFrom(row),
      });
      continue;
    }

    // The MVP only *selects and publishes* an expected restock date for SOLD OUT
    // products (see Olliix_MVP_Rule_Contract.md section 7); an IN STOCK row's
    // EXPECTED_DATE stays blank by design even when future incoming-date evidence
    // exists. The legacy workbook instead records raw date evidence regardless of
    // status, so that comparison only applies when a date could have been selected.
    //
    // DEV-004 (deviation register addition): the legacy workbook's "Expected Date
    // Source" column uses its own internal column-position labels (observed on
    // full-size data as e.g. "Incoming Date_5") rather than the WDC/SD3/SD2
    // warehouse codes this contract defines, so source-label text is compared for
    // display only and does not affect EXACT_MATCH classification. The date value
    // itself (normalized for the legacy export's Excel-serial-date quirk) is compared.
    const isSoldOut = norm(row.proposed.simpleInventory) === "SOLD OUT";
    const expectedDateMatches = !isSoldOut || norm(row.expectedDate) === norm(legacy.expectedDateRaw);

    const fieldsEqual =
      norm(row.proposed.simpleInventory) === norm(legacy.simpleInventory) &&
      norm(row.proposed.availability) === norm(legacy.availability) &&
      norm(row.proposed.restockMessage) === norm(legacy.restockMessage) &&
      norm(row.proposed.dataFeed) === norm(legacy.dataFeed) &&
      norm(row.proposed.shoppingFeed) === norm(legacy.shoppingFeed) &&
      norm(row.proposed.reportFlag) === norm(legacy.reportFlag) &&
      expectedDateMatches;

    results.push({
      sourceRowNumber: row.sourceRowNumber,
      productCode: row.productCode,
      itemNo: row.itemNo,
      rawUpc: row.rawUpc,
      itemName: row.description,
      comparisonClass: fieldsEqual ? "EXACT_MATCH" : "UNEXPLAINED_DIFFERENCE",
      deviationId: null,
      note: fieldsEqual ? "" : "Legacy managed values differ from the calculated result with no matching deviation register entry",
      ourValues: ourValuesFrom(row),
      legacyValues: legacyValuesFrom(legacy),
      mivaValues: mivaValuesFrom(row),
    });
  }

  return results;
}
