import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type { ReconciliationRow } from "@cozywinters/shared";
import { toExceptionRows, toUpdateBatchRows, toRollbackBatchRows, compareWithLegacy, verifyPostImport, VENDOR_REGISTRY } from "@cozywinters/shared";
import { parseOlliixWorkbook } from "../vendor/olliixParser";
import { parseMivaSnapshotCsv, mivaRowsByProductCode } from "../vendor/mivaCsv";
import { parseLegacyAuditCsv } from "../vendor/legacyAuditCsv";
import { runReconciliation } from "./runPipeline";

// runPipeline.ts now sources vendor config from the vendor_configs table
// instead of the static VENDOR_REGISTRY object -- mock the repository lookup
// with the exact same Olliix values the registry used to hold, so this
// byte-identical fixture suite proves the DB-backed path produces the same
// output as before, without needing a real database in this test.
vi.mock("../db", () => ({
  getRepository: () => ({
    findVendorConfigByKey: async (key: string) => {
      if (key !== "olliix") return null;
      const cfg = VENDOR_REGISTRY.olliix;
      return {
        vendorKey: "olliix",
        vendorLabel: cfg.vendorLabel,
        inStockThreshold: cfg.inStockThreshold,
        timezone: cfg.timezone,
        brandAllowlist: cfg.brandAllowlist,
        matchStrategy: cfg.matchStrategy,
        missingBlockerCode: cfg.missingBlockerCode ?? null,
        fileShape: "custom",
        columnMapping: null,
        pluginFilename: null,
        isActive: true,
        createdAt: "",
        updatedAt: "",
      };
    },
  }),
}));

// A byte-identical copy of the shared bake-off synthetic fixture bundle,
// vendored into this package so the automated test suite is self-contained
// and portable (no assumption about a sibling directory outside the app).
// Verified identical via `diff -rq` against the original package at copy time.
const FIXTURES_DIR = path.resolve(__dirname, "../../test-fixtures/synthetic");

function fx(name: string): string {
  const p = path.join(FIXTURES_DIR, name);
  if (!existsSync(p)) {
    throw new Error(`Fixture file not found: ${p}. Is the bake-off seed package present at the expected path?`);
  }
  return p;
}

function readCsvRecords(filePath: string): Record<string, string>[] {
  const text = readFileSync(filePath, "utf8");
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return parse(stripped, { columns: true, skip_empty_lines: true, bom: true });
}

const RUN_DATE = { year: 2026, month: 9, day: 18 };

// Demo decisions per fixtures/synthetic/README.md.
const APPROVED_PRODUCT_CODES = new Set(["P001", "P004", "P012", "P013", "P015", "P018", "P019", "P020"]);
const REJECTED_PRODUCT_CODES = new Set(["P002"]);

/**
 * The frozen bake-off fixture bundle (test-fixtures/synthetic/) predates the
 * DS_INV_MGT tracked-flag safety net added 2026-10-09. Its Miva snapshot
 * (Miva_synthetic_pre_import.csv) happens to leave DROPSHIP_INVENTORY_MANAGEMENT
 * blank on every "NO LONGER AVAILABLE" product -- not a deliberate test of this
 * feature, just incidental to when the column was retrofitted onto an already-
 * frozen file. expected_reconciliation.csv/expected_exceptions.csv are
 * deliberately NOT edited to match (README: "shared benchmark truth... do not
 * regenerate"), so these specific, well-understood divergences are asserted
 * here instead, with the real reason documented inline rather than silently
 * skipped. CASE_ID -> the exact field overrides that replace the frozen
 * file's expectation for that one row.
 */
const KNOWN_FIXTURE_DIVERGENCES: Record<string, { reviewClass?: string; warningCodes?: string }> = {
  // Previously CLEAN: a vendor re-shipping a blank-tracked-flag "NO LONGER
  // AVAILABLE" product is now exactly the silent-reactivation case the new
  // warning exists to catch.
  "SYN-001": { reviewClass: "WARNING", warningCodes: "MIVA_NOT_DROPSHIP_TRACKED" },
  "SYN-004": { reviewClass: "WARNING", warningCodes: "MIVA_NOT_DROPSHIP_TRACKED" },
  // Already WARNING for an unrelated reason; the blank tracked-flag now adds
  // a second code alongside the original one (pushed first -- see reconcile.ts).
  "SYN-012": { warningCodes: "MIVA_NOT_DROPSHIP_TRACKED,WAREHOUSE_TOTAL_MISMATCH" },
  "SYN-014": { warningCodes: "MIVA_NOT_DROPSHIP_TRACKED,EXPECTED_DATE_CONFLICT" },
  "SYN-016": { warningCodes: "MIVA_NOT_DROPSHIP_TRACKED,DATE_WITH_NONPOSITIVE_INCOMING_QTY" },
  "SYN-017": { warningCodes: "MIVA_NOT_DROPSHIP_TRACKED,INCOMING_QTY_WITHOUT_DATE" },
};

describe("synthetic fixture suite (28 cases)", () => {
  let rows: ReconciliationRow[];

  beforeAll(async () => {
    const olliixBuffer = readFileSync(fx("Olliix_synthetic_inventory.xlsx"));
    const { rows: olliixRows } = await parseOlliixWorkbook(olliixBuffer);
    const mivaText = readFileSync(fx("Miva_synthetic_pre_import.csv"), "utf8");
    const { rows: mivaRows } = parseMivaSnapshotCsv(mivaText);
    const result = await runReconciliation({ vendorKey: "olliix", vendorRows: olliixRows, mivaRows, runDate: RUN_DATE });
    rows = result.rows;
  });

  function findRow(bySourceRow: string, byProductCode: string): ReconciliationRow | undefined {
    if (bySourceRow !== "") {
      const n = Number(bySourceRow);
      return rows.find((r) => r.sourceRowNumber === n);
    }
    return rows.find((r) => r.sourceRowNumber === null && r.productCode === byProductCode);
  }

  it("reproduces expected_reconciliation.csv field-for-field", () => {
    const expected = readCsvRecords(fx("expected_reconciliation.csv"));
    expect(rows.length).toBe(expected.length);

    for (const exp of expected) {
      const row = findRow(exp.SOURCE_ROW!, exp.PRODUCT_CODE!);
      expect(row, `no engine row found for case ${exp.CASE_ID}`).toBeTruthy();
      const r = row!;

      expect(r.itemNo ?? "", `${exp.CASE_ID} ITEM_NO`).toBe(exp.ITEM_NO ?? "");
      expect(r.rawUpc ?? "", `${exp.CASE_ID} RAW_UPC`).toBe(exp.RAW_UPC ?? "");
      expect(r.normalizedUpc ?? "", `${exp.CASE_ID} NORMALIZED_UPC`).toBe(exp.NORMALIZED_UPC ?? "");
      expect(r.productCode ?? "", `${exp.CASE_ID} PRODUCT_CODE`).toBe(exp.PRODUCT_CODE ?? "");
      const divergence = KNOWN_FIXTURE_DIVERGENCES[exp.CASE_ID!];
      expect(r.matchOutcome, `${exp.CASE_ID} MATCH_OUTCOME`).toBe(exp.MATCH_OUTCOME);
      expect(r.reviewClass, `${exp.CASE_ID} REVIEW_CLASS`).toBe(divergence?.reviewClass ?? exp.REVIEW_CLASS);
      expect(r.warningCodes.join(","), `${exp.CASE_ID} WARNING_CODES`).toBe(divergence?.warningCodes ?? exp.WARNING_CODES ?? "");
      expect(r.blockerCodes.join(","), `${exp.CASE_ID} BLOCKER_CODES`).toBe(exp.BLOCKER_CODES ?? "");
      expect(r.totalQtyRaw ?? "", `${exp.CASE_ID} TOTAL_QTY`).toBe(exp.TOTAL_QTY ?? "");
      expect(r.expectedDate ?? "", `${exp.CASE_ID} EXPECTED_DATE`).toBe(exp.EXPECTED_DATE ?? "");
      expect(r.expectedDateSources.join("|"), `${exp.CASE_ID} EXPECTED_DATE_SOURCES`).toBe(exp.EXPECTED_DATE_SOURCES ?? "");
      expect(r.current.simpleInventory ?? "", `${exp.CASE_ID} CURRENT_SIMPLE_INVENTORY`).toBe(exp.CURRENT_SIMPLE_INVENTORY ?? "");
      expect(r.proposed.simpleInventory ?? "", `${exp.CASE_ID} PROPOSED_SIMPLE_INVENTORY`).toBe(exp.PROPOSED_SIMPLE_INVENTORY ?? "");
      expect(r.current.availability ?? "", `${exp.CASE_ID} CURRENT_AVAILABILITY`).toBe(exp.CURRENT_AVAILABILITY ?? "");
      expect(r.proposed.availability ?? "", `${exp.CASE_ID} PROPOSED_AVAILABILITY`).toBe(exp.PROPOSED_AVAILABILITY ?? "");
      expect(r.current.restockMessage ?? "", `${exp.CASE_ID} CURRENT_RESTOCK`).toBe(exp.CURRENT_RESTOCK ?? "");
      expect(r.proposed.restockMessage ?? "", `${exp.CASE_ID} PROPOSED_RESTOCK`).toBe(exp.PROPOSED_RESTOCK ?? "");
      expect(r.current.dataFeed ?? "", `${exp.CASE_ID} CURRENT_DATAFEED`).toBe(exp.CURRENT_DATAFEED ?? "");
      expect(r.proposed.dataFeed ?? "", `${exp.CASE_ID} PROPOSED_DATAFEED`).toBe(exp.PROPOSED_DATAFEED ?? "");
      expect(r.current.shoppingFeed ?? "", `${exp.CASE_ID} CURRENT_SHOPPING_FEED`).toBe(exp.CURRENT_SHOPPING_FEED ?? "");
      expect(r.proposed.shoppingFeed ?? "", `${exp.CASE_ID} PROPOSED_SHOPPING_FEED`).toBe(exp.PROPOSED_SHOPPING_FEED ?? "");
      expect(r.current.dsInvMgt ?? "", `${exp.CASE_ID} CURRENT_DS_INV_MGT`).toBe(exp.CURRENT_DS_INV_MGT ?? "");
      expect(r.proposed.dsInvMgt ?? "", `${exp.CASE_ID} PROPOSED_DS_INV_MGT`).toBe(exp.PROPOSED_DS_INV_MGT ?? "");
      expect(r.changed ? "1" : "0", `${exp.CASE_ID} CHANGED`).toBe(exp.CHANGED ?? "0");

      const expectedInBatch = exp.IN_EXPECTED_BATCH === "1";
      const actuallyEligible = r.isEligibleForApproval;
      if (expectedInBatch) {
        expect(actuallyEligible, `${exp.CASE_ID} should be eligible for approval`).toBe(true);
      }
    }
  });

  it("matches expected_exceptions.csv", () => {
    const frozenExpected = readCsvRecords(fx("expected_exceptions.csv"));

    // SYN-001/SYN-004 were CLEAN in the frozen file (no exception row at
    // all); the new tracked-flag warning now makes both WARNING, so they
    // must appear here too. Inserted and re-sorted the same way
    // sortForReview orders the real rows (by sourceRowNumber), rather than
    // editing the frozen CSV -- see KNOWN_FIXTURE_DIVERGENCES above.
    const newExceptionRows = [
      { CASE_ID: "SYN-001", SOURCE_ROW: "3", ITEM_NO: "SYN-001", PRODUCT_CODE: "P001", SEVERITY: "WARNING", REASON_CODES: "MIVA_NOT_DROPSHIP_TRACKED", APPROVAL_ELIGIBILITY: "INDIVIDUAL_WITH_ACK" },
      { CASE_ID: "SYN-004", SOURCE_ROW: "6", ITEM_NO: "SYN-004", PRODUCT_CODE: "P004", SEVERITY: "WARNING", REASON_CODES: "MIVA_NOT_DROPSHIP_TRACKED", APPROVAL_ELIGIBILITY: "INDIVIDUAL_WITH_ACK" },
    ];
    const expected = [...frozenExpected, ...newExceptionRows].sort((a, b) => {
      const aKey = a.SOURCE_ROW === "" ? Number.MAX_SAFE_INTEGER : Number(a.SOURCE_ROW);
      const bKey = b.SOURCE_ROW === "" ? Number.MAX_SAFE_INTEGER : Number(b.SOURCE_ROW);
      return aKey - bKey;
    });

    const actual = toExceptionRows(rows);
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      const exp = expected[i]!;
      const act = actual[i]!;
      const divergence = KNOWN_FIXTURE_DIVERGENCES[exp.CASE_ID!];
      expect(String(act.sourceRowNumber ?? ""), `row ${i} SOURCE_ROW`).toBe(exp.SOURCE_ROW ?? "");
      expect(act.itemNo ?? "", `row ${i} ITEM_NO`).toBe(exp.ITEM_NO ?? "");
      expect(act.productCode ?? "", `row ${i} PRODUCT_CODE`).toBe(exp.PRODUCT_CODE ?? "");
      expect(act.severity, `row ${i} SEVERITY`).toBe(divergence?.reviewClass ?? exp.SEVERITY);
      expect(act.reasonCodes, `row ${i} REASON_CODES`).toBe(divergence?.warningCodes ?? exp.REASON_CODES);
      expect(act.approvalEligibility, `row ${i} APPROVAL_ELIGIBILITY`).toBe(exp.APPROVAL_ELIGIBILITY);
    }
  });

  it("generates expected_update.csv and expected_rollback.csv from the demo decisions", () => {
    const approvedChanged = rows.filter((r) => r.productCode && APPROVED_PRODUCT_CODES.has(r.productCode));
    expect(approvedChanged.length).toBe(APPROVED_PRODUCT_CODES.size);

    const updateRows = toUpdateBatchRows(approvedChanged);
    const expectedUpdate = readCsvRecords(fx("expected_update.csv"));
    expect(updateRows.length).toBe(expectedUpdate.length);
    for (let i = 0; i < expectedUpdate.length; i++) {
      expect(updateRows[i]).toEqual(expectedUpdate[i]);
    }

    const rollbackRows = toRollbackBatchRows(approvedChanged);
    const expectedRollback = readCsvRecords(fx("expected_rollback.csv"));
    expect(rollbackRows.length).toBe(expectedRollback.length);
    for (let i = 0; i < expectedRollback.length; i++) {
      expect(rollbackRows[i]).toEqual(expectedRollback[i]);
    }
  });

  it("keeps P002 eligible-but-rejected out of the approved batch set", () => {
    const p002 = rows.find((r) => r.productCode === "P002");
    expect(p002).toBeTruthy();
    expect(p002!.isEligibleForApproval).toBe(true); // clean and changed: eligible to approve...
    expect(REJECTED_PRODUCT_CODES.has("P002")).toBe(true); // ...but the demo decision rejects it.
    // Batch membership is driven by the caller's approval set (see the batch
    // generation test above), not by row eligibility alone: an eligible row
    // the operator rejected must never be passed into toUpdateBatchRows.
    const approvedChanged = rows.filter((r) => r.productCode && APPROVED_PRODUCT_CODES.has(r.productCode));
    expect(approvedChanged.some((r) => r.productCode === "P002")).toBe(false);
  });

  it("matches expected_legacy_comparison.csv", () => {
    const legacyText = readFileSync(fx("Olliix_Audit_Master_synthetic_legacy.csv"), "utf8");
    const legacyRows = parseLegacyAuditCsv(legacyText);
    const comparison = compareWithLegacy(rows, legacyRows);
    const expected = readCsvRecords(fx("expected_legacy_comparison.csv"));

    expect(comparison.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      const exp = expected[i]!;
      const act = comparison[i]!;
      expect(act.comparisonClass, `row ${i} (${exp.CASE_ID}) class`).toBe(exp.EXPECTED_COMPARISON_CLASS);
      expect(act.deviationId ?? "", `row ${i} (${exp.CASE_ID}) deviation`).toBe(exp.DEVIATION_ID ?? "");
    }

    const unexplained = comparison.filter((c) => c.comparisonClass === "UNEXPLAINED_DIFFERENCE");
    expect(unexplained.length).toBe(1);
    expect(unexplained[0]!.productCode).toBe("P001");
  });

  it("matches expected_post_import_verification.csv", () => {
    const approvedChanged = rows.filter((r) => r.productCode && APPROVED_PRODUCT_CODES.has(r.productCode));
    const updateRows = toUpdateBatchRows(approvedChanged);

    const preText = readFileSync(fx("Miva_synthetic_pre_import.csv"), "utf8");
    const { rows: preRows } = parseMivaSnapshotCsv(preText);
    const postText = readFileSync(fx("Miva_synthetic_post_import.csv"), "utf8");
    const { rows: postRows } = parseMivaSnapshotCsv(postText);

    const verification = verifyPostImport({
      approvedBatchRows: updateRows,
      preImportByProductCode: mivaRowsByProductCode(preRows),
      postImportByProductCode: mivaRowsByProductCode(postRows),
    });

    const expected = readCsvRecords(fx("expected_post_import_verification.csv"));
    expect(verification.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(verification[i]!.productCode, `row ${i} PRODUCT_CODE`).toBe(expected[i]!.PRODUCT_CODE);
      expect(verification[i]!.result, `row ${i} RESULT`).toBe(expected[i]!.EXPECTED_RESULT);
      expect(verification[i]!.reason, `row ${i} REASON`).toBe(expected[i]!.REASON);
    }
  });
});
