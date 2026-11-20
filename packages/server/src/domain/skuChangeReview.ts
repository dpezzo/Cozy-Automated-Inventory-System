import { normalizeUpc } from "@cozywinters/shared";
import type { RunningChangeRow } from "../vendor/runningChangeParser";

export type SkuChangeAction = "RENAME" | "HOLD" | "SKIP";

export interface SkuChangeMivaProduct {
  productCode: string;
  gtinRaw: string | null;
  mpnRaw: string | null;
}
export interface SkuChangeDealerItem {
  itemNo: string;
  totalQtyRaw: string | null;
}

export interface SkuChangeReviewRow {
  MIVA_PRODUCT_CODE: string;
  MIVA_CURRENT_MPN: string;
  OLD_SKU: string;
  NEW_SKU: string;
  UPC: string;
  TIER: string;
  PROPOSED_ACTION: SkuChangeAction;
  REASON: string;
  OLD_SKU_IN_DEALER_FILE: string;
  OLD_SKU_QTY: string;
  NEW_SKU_IN_DEALER_FILE: string;
  NEW_SKU_QTY: string;
  NEW_SKU_DISCONTINUED: string;
  PACK_QTY: string;
  PRODUCT: string;
  OLLIIX_ACTION_TEXT: string;
  OLLIIX_NOTES: string;
}

export const SKU_CHANGE_REVIEW_HEADERS: (keyof SkuChangeReviewRow)[] = [
  "MIVA_PRODUCT_CODE", "MIVA_CURRENT_MPN", "OLD_SKU", "NEW_SKU", "UPC", "TIER", "PROPOSED_ACTION", "REASON",
  "OLD_SKU_IN_DEALER_FILE", "OLD_SKU_QTY", "NEW_SKU_IN_DEALER_FILE", "NEW_SKU_QTY", "NEW_SKU_DISCONTINUED",
  "PACK_QTY", "PRODUCT", "OLLIIX_ACTION_TEXT", "OLLIIX_NOTES",
];

/** Row background colors (RGB hex) for the review workbook; the legend is in the CHANGELOG and handed to Cale with the file. */
export const SKU_CHANGE_COLORS = {
  ready: "BDD7EE", // blue: RENAME, ready now
  done: "C6EFCE", // green: Miva MPN already equals the new SKU
  waiting: "FFEB9C", // yellow: HOLD, new SKU not in the dealer file yet
  problem: "FFC7CE", // red: HOLD for any other reason (no Miva match, discontinued, MPN mismatch)
  noAction: "EDEDED", // grey: tier 2 / tier 3, nothing to do
} as const;

export function skuChangeRowColor(row: SkuChangeReviewRow): string {
  if (row.PROPOSED_ACTION === "RENAME") return SKU_CHANGE_COLORS.ready;
  if (row.PROPOSED_ACTION === "SKIP") return row.REASON.startsWith("Miva MPN already") ? SKU_CHANGE_COLORS.done : SKU_CHANGE_COLORS.noAction;
  return row.REASON.startsWith("New SKU is not in the dealer") ? SKU_CHANGE_COLORS.waiting : SKU_CHANGE_COLORS.problem;
}

const key = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/**
 * Cross-references Olliix's running change list with the Miva snapshot, the latest dealer inventory
 * and the discontinued list. Pure: no I/O, writes nothing. The join to Miva is UPC to GTIN (same as
 * reconciliation); SKUs only decide whether a candidate is ready to rename.
 */
export function buildSkuChangeReview(input: {
  changes: RunningChangeRow[];
  miva: SkuChangeMivaProduct[];
  dealerItems: SkuChangeDealerItem[];
  discontinuedItemNos: string[];
}): SkuChangeReviewRow[] {
  const dealer = new Map(input.dealerItems.map((d) => [key(d.itemNo), d]));
  const discontinued = new Set(input.discontinuedItemNos.map(key));
  const mivaByGtin = new Map<string, SkuChangeMivaProduct[]>();
  for (const p of input.miva) {
    const n = normalizeUpc(p.gtinRaw);
    if (!n.valid || !n.normalized) continue;
    const list = mivaByGtin.get(n.normalized) ?? [];
    list.push(p);
    mivaByGtin.set(n.normalized, list);
  }

  const out: SkuChangeReviewRow[] = [];
  for (const c of input.changes) {
    const upc = normalizeUpc(c.upcRaw);
    const oldD = dealer.get(key(c.oldSku));
    const newD = dealer.get(key(c.newSku));
    const isDisc = discontinued.has(key(c.newSku));
    const upcKey = upc.valid ? upc.normalized : null;
    const matches = upcKey ? (mivaByGtin.get(upcKey) ?? []) : [];

    const base = {
      OLD_SKU: c.oldSku,
      NEW_SKU: c.newSku,
      UPC: upcKey ?? c.upcRaw,
      TIER: c.tier,
      OLD_SKU_IN_DEALER_FILE: oldD ? "Yes" : "No",
      OLD_SKU_QTY: oldD?.totalQtyRaw ?? "",
      NEW_SKU_IN_DEALER_FILE: newD ? "Yes" : "No",
      NEW_SKU_QTY: newD?.totalQtyRaw ?? "",
      NEW_SKU_DISCONTINUED: isDisc ? "Yes" : "No",
      PACK_QTY: c.packQty,
      PRODUCT: c.product,
      OLLIIX_ACTION_TEXT: c.actionText,
      OLLIIX_NOTES: c.notes,
    };

    const decide = (m: SkuChangeMivaProduct | null): { action: SkuChangeAction; reason: string } => {
      if (c.tier === "2") return { action: "SKIP", reason: "Tier 2: Olliix maps the new SKU to our existing SKU. No change needed." };
      if (c.tier === "3") return { action: "SKIP", reason: "Tier 3: new SKU not released yet." };
      if (c.tier !== "1A" && c.tier !== "1B" && c.tier !== "1C") return { action: "HOLD", reason: "Unrecognized tier in Olliix file." };
      if (!m) return { action: "HOLD", reason: "No Miva product has this UPC as its GTIN." };
      if (key(m.mpnRaw) === key(c.newSku)) return { action: "SKIP", reason: "Miva MPN already equals the new SKU." };
      if (isDisc) return { action: "HOLD", reason: "New SKU is on the discontinued list." };
      if (c.tier === "1C" || !newD) return { action: "HOLD", reason: "New SKU is not in the dealer inventory file yet." };
      if (key(m.mpnRaw) !== key(c.oldSku)) return { action: "HOLD", reason: `Miva MPN (${m.mpnRaw || "blank"}) does not match Olliix's old SKU.` };
      return { action: "RENAME", reason: "New SKU is in the dealer file, not discontinued, UPC matches a Miva product." };
    };

    if (matches.length === 0) {
      const d = decide(null);
      out.push({ MIVA_PRODUCT_CODE: "", MIVA_CURRENT_MPN: "", ...base, PROPOSED_ACTION: d.action, REASON: d.reason });
    } else {
      for (const m of matches) {
        const d = decide(m);
        out.push({ MIVA_PRODUCT_CODE: m.productCode, MIVA_CURRENT_MPN: m.mpnRaw ?? "", ...base, PROPOSED_ACTION: d.action, REASON: d.reason });
      }
    }
  }
  return out;
}
