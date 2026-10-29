import type { MivaRawRow, VendorRawRow, ReconciliationRow, VendorRuleConfig } from "@cozywinters/shared";
import { computeRuleConfigHash, reconcile, type ParsedCalendarDate } from "@cozywinters/shared";
import { getRepository, type VendorConfigRecord } from "../db";
import { ValidationError } from "../errors";
import { DISCONTINUED_LIST_VENDOR_KEY } from "./discontinuedListService";

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
    discontinuedThreshold: record.discontinuedThreshold ?? undefined,
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
  // Only the discontinued-list vendor (Olliix, whose feed has no phase column) runs in list mode. Passing a set --
  // even an empty one -- is what restricts its "missing from feed" NLA proposals to listed products; Gobi must
  // never receive one, since its own Product Phase column drives it.
  const discontinuedUpcs =
    config.discontinuedThreshold !== undefined && input.vendorKey === DISCONTINUED_LIST_VENDOR_KEY
      ? new Set(await getRepository().listDiscontinuedUpcs(input.vendorKey))
      : undefined;
  const { rows } = reconcile(input.vendorRows, input.mivaRows, {
    config,
    runDate: input.runDate,
    discontinuedUpcs,
  });
  return {
    rows,
    ruleId: config.ruleId,
    ruleConfigHash: computeRuleConfigHash(config),
  };
}
