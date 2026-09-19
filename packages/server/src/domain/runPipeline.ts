import type { MivaRawRow, OlliixRawRow, ReconciliationRow } from "@cozywinters/shared";
import { OLLIIX_RULE_CONFIG, computeRuleConfigHash, reconcile, type ParsedCalendarDate } from "@cozywinters/shared";

export interface RunPipelineInput {
  olliixRows: OlliixRawRow[];
  mivaRows: MivaRawRow[];
  runDate: ParsedCalendarDate;
}

export interface RunPipelineResult {
  rows: ReconciliationRow[];
  ruleId: string;
  ruleConfigHash: string;
}

/**
 * Orchestrates the pure reconciliation engine for one run. Contains no I/O:
 * callers supply already-parsed rows and persist the result themselves.
 */
export function runReconciliation(input: RunPipelineInput): RunPipelineResult {
  const { rows } = reconcile(input.olliixRows, input.mivaRows, {
    config: OLLIIX_RULE_CONFIG,
    runDate: input.runDate,
  });
  return {
    rows,
    ruleId: OLLIIX_RULE_CONFIG.ruleId,
    ruleConfigHash: computeRuleConfigHash(OLLIIX_RULE_CONFIG),
  };
}
