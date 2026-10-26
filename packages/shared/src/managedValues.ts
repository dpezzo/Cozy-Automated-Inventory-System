import type { ManagedValues } from "./types";

/**
 * DROPSHIP_INVENTORY_MANAGEMENT (DS_INV_MGT) values (Cale, 2026-10-25):
 *   blank = do not manage inventory (the app only reports on it)
 *   "1"   = manage dropship inventory
 *   "2"   = manage inventory exactly like "1", but never push the product to the
 *           shopping feed (availability blank, datafeed blank, shopping feed Exclude)
 *   "3"   = hide from the app entirely: no run row, no warning, not counted
 */
export const DS_INV_MGT_NO_FEED = "2";
export const DS_INV_MGT_HIDDEN = "3";

export interface ProposedValuesOptions {
  /** True for a product whose DS_INV_MGT is "2": whatever the stock status, availability and datafeed are blank, shopping feed is Exclude, and DS_INV_MGT stays "2". */
  feedExcluded?: boolean;
}

/** Computes proposed managed values per Olliix_MVP_Rule_Contract.md section 8 (IN STOCK / SOLD OUT), plus the NLA recipe for phase-aware vendors. */
export function computeProposedManagedValues(
  status: "IN STOCK" | "SOLD OUT" | "NLA",
  expectedDate: string | null,
  options: ProposedValuesOptions = {},
): ManagedValues {
  const base = computeStatusValues(status, expectedDate);
  if (!options.feedExcluded) return base;
  return { ...base, availability: "", dataFeed: "", shoppingFeed: "Exclude", dsInvMgt: DS_INV_MGT_NO_FEED };
}

function computeStatusValues(
  status: "IN STOCK" | "SOLD OUT" | "NLA",
  expectedDate: string | null,
): ManagedValues {
  // NLA recipe (Cale, 2026-10-25): status "NO LONGER AVAILABLE", availability /
  // restock message / datafeed / DS_INV_MGT all blank, shopping feed "Exclude".
  // Blank DS_INV_MGT takes the product out of the app's own tracked population,
  // matching how the existing NLA products in Miva are already set up.
  if (status === "NLA") {
    return {
      simpleInventory: "NO LONGER AVAILABLE",
      availability: "",
      restockMessage: "",
      dataFeed: "",
      shoppingFeed: "Exclude",
      dsInvMgt: "",
    };
  }
  if (status === "IN STOCK") {
    return {
      simpleInventory: "IN STOCK",
      availability: "in stock",
      restockMessage: "",
      dataFeed: "Yes",
      shoppingFeed: "",
      dsInvMgt: "1",
    };
  }
  return {
    simpleInventory: "SOLD OUT",
    availability: "out of stock",
    restockMessage: expectedDate ? `<b>Out until ${expectedDate}</b>` : "",
    dataFeed: "Yes",
    shoppingFeed: "",
    dsInvMgt: "1",
  };
}

const MANAGED_FIELDS: (keyof ManagedValues)[] = [
  "simpleInventory",
  "availability",
  "restockMessage",
  "dataFeed",
  "shoppingFeed",
  "dsInvMgt",
];

function normalizeForCompare(value: string | undefined): string {
  return (value ?? "").trim();
}

export function managedValuesEqual(
  current: Partial<ManagedValues>,
  proposed: Partial<ManagedValues>,
): boolean {
  return MANAGED_FIELDS.every(
    (field) => normalizeForCompare(current[field]) === normalizeForCompare(proposed[field]),
  );
}

export function diffFields(
  current: Partial<ManagedValues>,
  proposed: Partial<ManagedValues>,
): (keyof ManagedValues)[] {
  return MANAGED_FIELDS.filter(
    (field) => normalizeForCompare(current[field]) !== normalizeForCompare(proposed[field]),
  );
}
