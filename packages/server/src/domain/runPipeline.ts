import type { MivaRawRow, VendorRawRow, ReconciliationRow, VendorRuleConfig } from "@cozywinters/shared";
import { computeRuleConfigHash, reconcile, type ParsedCalendarDate } from "@cozywinters/shared";
import { getRepository, type VendorConfigRecord } from "../db";
import { ValidationError } from "../errors";

export interface RunPipelineInput {
  /** Matches vendor_configs.vendor_key -- a built-in VendorKey string for the 4 legacy vendors, or any dynamically-added vendor's slug. */
  vendorKey: string;
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
 * ruleId is deliberately not a vendor_configs column -- it's always derived
 * from the immutable vendor_key, matching every one of today's 4 built-in
 * vendors' existing hardcoded ruleId (e.g. "olliix-inventory-v1"). This keeps
 * rule_config_hash byte-identical across the move from the static
 * VENDOR_REGISTRY object to this DB-backed lookup.
 */
function ruleIdFor(vendorKey: string): string {
  return `${vendorKey}-inventory-v1`;
}

function toVendorRuleConfig(record: VendorConfigRecord): VendorRuleConfig {
  return {
    ruleId: ruleIdFor(record.vendorKey),
    vendorLabel: record.vendorLabel,
    inStockThreshold: record.inStockThreshold,
    timezone: record.timezone,
    brandAllowlist: record.brandAllowlist,
    matchStrategy: record.matchStrategy,
    missingBlockerCode: record.missingBlockerCode ?? undefined,
  };
}

/**
 * Orchestrates the pure reconciliation engine for one run. Contains no I/O
 * beyond the single vendor_configs lookup: callers supply already-parsed
 * rows and persist the result themselves. The vendor's rule config
 * (threshold, brand scope, match strategy) is loaded from the vendor_configs
 * table by vendorKey, so editing it via Manage Vendors takes effect on the
 * next run without any code change or redeploy.
 */
export async function runReconciliation(input: RunPipelineInput): Promise<RunPipelineResult> {
  const record = await getRepository().findVendorConfigByKey(input.vendorKey);
  if (!record || !record.isActive) {
    throw new ValidationError("VENDOR_CONFIG_NOT_FOUND", `No active vendor configuration found for "${input.vendorKey}".`);
  }
  const config = toVendorRuleConfig(record);
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
