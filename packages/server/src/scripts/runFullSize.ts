/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  toExceptionRows,
  toUpdateBatchRows,
  toRollbackBatchRows,
  compareWithLegacy,
} from "@cozywinters/shared";
import { parseOlliixWorkbook } from "../vendor/olliixParser";
import { parseMivaSnapshotCsv } from "../vendor/mivaCsv";
import { parseLegacyAuditCsv } from "../vendor/legacyAuditCsv";
import { runReconciliation } from "../domain/runPipeline";
import { rowsToCsv } from "../csv/writeCsv";
import { UPDATE_ROLLBACK_HEADERS } from "@cozywinters/shared";

const SEED_DIR = path.resolve(__dirname, "../../../../../package/CozyWinters_Olliix_MVP_Bakeoff_Seed");

async function main() {
  const start = Date.now();
  const olliixBuffer = readFileSync(path.join(SEED_DIR, "Olliix_daily_inventory.xlsx"));
  const { rows: olliixRows } = await parseOlliixWorkbook(olliixBuffer);
  console.log(`Olliix rows parsed: ${olliixRows.length}`);

  const mivaText = readFileSync(path.join(SEED_DIR, "Miva_complete_product_export.csv"), "utf8");
  const { rows: mivaRows } = parseMivaSnapshotCsv(mivaText);
  console.log(`Miva rows parsed: ${mivaRows.length}`);

  const runDate = { year: 2026, month: 9, day: 18 };
  const { rows, ruleId, ruleConfigHash } = runReconciliation({ olliixRows, mivaRows, runDate });
  const parseMs = Date.now() - start;

  console.log(`\nRule: ${ruleId}  hash: ${ruleConfigHash}`);
  console.log(`Total reconciliation rows: ${rows.length}`);

  const byOutcome = new Map<string, number>();
  const byReviewClass = new Map<string, number>();
  for (const r of rows) {
    byOutcome.set(r.matchOutcome, (byOutcome.get(r.matchOutcome) ?? 0) + 1);
    byReviewClass.set(r.reviewClass, (byReviewClass.get(r.reviewClass) ?? 0) + 1);
  }
  console.log("\nBy match outcome:");
  for (const [k, v] of byOutcome) console.log(`  ${k}: ${v}`);
  console.log("\nBy review class:");
  for (const [k, v] of byReviewClass) console.log(`  ${k}: ${v}`);

  const exceptions = toExceptionRows(rows);
  console.log(`\nException rows (warning + blocked): ${exceptions.length}`);

  const eligibleClean = rows.filter((r) => r.reviewClass === "CLEAN");
  console.log(`Clean eligible rows (approve-all candidates): ${eligibleClean.length}`);

  const updateRows = toUpdateBatchRows(eligibleClean);
  const rollbackRows = toRollbackBatchRows(eligibleClean);
  console.log(`Simulated 'approve all clean' batch size: ${updateRows.length}`);

  const legacyText = readFileSync(path.join(SEED_DIR, "Olliix_Audit_Master.csv"), "utf8");
  const legacyRows = parseLegacyAuditCsv(legacyText);
  const comparison = compareWithLegacy(rows, legacyRows);
  const byClass = new Map<string, number>();
  for (const c of comparison) byClass.set(c.comparisonClass, (byClass.get(c.comparisonClass) ?? 0) + 1);
  console.log("\nLegacy comparison classification counts:");
  for (const [k, v] of byClass) console.log(`  ${k}: ${v}`);

  const outDir = path.resolve(__dirname, "../../../../.fullsize-output");
  const fs = await import("node:fs");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "update.csv"), rowsToCsv(updateRows, [...UPDATE_ROLLBACK_HEADERS]));
  fs.writeFileSync(path.join(outDir, "rollback.csv"), rowsToCsv(rollbackRows, [...UPDATE_ROLLBACK_HEADERS]));
  console.log(`\nWrote sample batch files to ${outDir}`);

  const totalMs = Date.now() - start;
  console.log(`\nTotal wall time: ${totalMs}ms (parse+reconcile: ${parseMs}ms)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
