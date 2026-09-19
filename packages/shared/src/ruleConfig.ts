import { createHash } from "node:crypto";
import type { OlliixRuleConfig } from "./types";

// Pinned rule identity per Olliix_MVP_Rule_Contract.md section 1.
export const OLLIIX_RULE_CONFIG: OlliixRuleConfig = {
  ruleId: "olliix-inventory-v1",
  inStockThreshold: 6,
  timezone: "America/New_York",
  brandAllowlist: [
    "Beautyrest",
    "Serta",
    "True North by Sleep Philosophy",
    "Woolrich",
    "Sharper Image",
  ],
};

/**
 * Deterministic hash of the full effective configuration. Every run pins this
 * hash alongside the rule identifier so results can be traced back to the
 * exact configuration that produced them.
 */
export function computeRuleConfigHash(config: OlliixRuleConfig = OLLIIX_RULE_CONFIG): string {
  const canonical = JSON.stringify({
    ruleId: config.ruleId,
    inStockThreshold: config.inStockThreshold,
    timezone: config.timezone,
    brandAllowlist: [...config.brandAllowlist].sort(),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
