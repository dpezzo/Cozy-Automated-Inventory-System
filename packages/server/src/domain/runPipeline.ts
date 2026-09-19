import type { MivaRawRow, VendorRawRow, ReconciliationRow, VendorKey } from "@cozywinters/shared";
import { VENDOR_REGISTRY, computeRuleConfigHash, reconcile, type ParsedCalendarDate } from "@cozywinters/shared";

export interface RunPipelineInput {
  vendorKey: VendorKey;
  vendorRows: VendorRawRow[];
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
 * callers supply already-parsed rows and persist the result themselves. The
 * vendor's own rule config (threshold, brand scope, match strategy) is
 * looked up from the shared vendor registry by `vendorKey` -- adding a new
 * vendor never requires a change here.
 */
export function runReconciliation(input: RunPipelineInput): RunPipelineResult {
  const config = VENDOR_REGISTRY[input.vendorKey];
  const { rows } = reconcile(input.vendorRows, input.mivaRows, {
    config,
    runDate: input.runDate,
  });
  return {
    rows,
    ruleId: config.ruleId,
    ruleConfigHash: computeRuleConfigHash(config),
  };
}
