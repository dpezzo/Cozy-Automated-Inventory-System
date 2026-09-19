import { createHash } from "node:crypto";
import type { VendorRuleConfig } from "./types";

/**
 * Single source of truth for every vendor's matching rule, in-stock
 * threshold, and Miva-side brand scope. To change a vendor's threshold or
 * brand allowlist, edit its entry here -- nothing else needs to change.
 * Adding a brand-new vendor means adding a new entry here plus a parser
 * under packages/server/src/vendor/ and a FileKind in db/types.ts; nothing
 * about this registry format needs to change to support that.
 */
export const VENDOR_REGISTRY = {
  olliix: {
    ruleId: "olliix-inventory-v1",
    vendorLabel: "Olliix",
    inStockThreshold: 6,
    timezone: "America/New_York",
    brandAllowlist: ["Beautyrest", "Serta", "True North by Sleep Philosophy", "Woolrich", "Sharper Image"],
    matchStrategy: "upc-to-gtin",
    // Pinned for byte-identical compatibility with the immutable bake-off fixture bundle.
    missingBlockerCode: "MISSING_FROM_OLLIIX",
  },
  kh: {
    ruleId: "kh-inventory-v1",
    vendorLabel: "K&H Pet Products",
    inStockThreshold: 3,
    timezone: "America/New_York",
    brandAllowlist: ["K&H Pet Products"],
    matchStrategy: "upc-to-gtin",
  },
  gobi: {
    ruleId: "gobi-inventory-v1",
    vendorLabel: "Gobi Heat",
    inStockThreshold: 6,
    timezone: "America/New_York",
    brandAllowlist: ["Gobi Heat"],
    matchStrategy: "sku-to-mpn",
  },
  fieldsheer: {
    ruleId: "fieldsheer-inventory-v1",
    vendorLabel: "FieldSheer/MobileWarming",
    inStockThreshold: 6,
    timezone: "America/New_York",
    brandAllowlist: ["Mobile Warming"],
    matchStrategy: "sku-to-mpn",
  },
} as const satisfies Record<string, VendorRuleConfig>;

export type VendorKey = keyof typeof VENDOR_REGISTRY;

export function vendorConfigByRuleId(ruleId: string): VendorRuleConfig | undefined {
  return Object.values(VENDOR_REGISTRY).find((v) => v.ruleId === ruleId);
}

/**
 * Deterministic hash of the full effective configuration. Every run pins this
 * hash alongside the rule identifier so results can be traced back to the
 * exact configuration that produced them.
 */
export function computeRuleConfigHash(config: VendorRuleConfig): string {
  const canonical = JSON.stringify({
    ruleId: config.ruleId,
    inStockThreshold: config.inStockThreshold,
    timezone: config.timezone,
    brandAllowlist: [...config.brandAllowlist].sort(),
    matchStrategy: config.matchStrategy,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
