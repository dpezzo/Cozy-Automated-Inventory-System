import type { ManagedValues } from "./types";

/** Computes proposed managed values per Olliix_MVP_Rule_Contract.md section 8. */
export function computeProposedManagedValues(
  status: "IN STOCK" | "SOLD OUT",
  expectedDate: string | null,
): ManagedValues {
  if (status === "IN STOCK") {
    return {
      simpleInventory: "IN STOCK",
      availability: "in stock",
      restockMessage: "",
      dataFeed: "Yes",
      shoppingFeed: "",
      reportFlag: "1",
    };
  }
  return {
    simpleInventory: "SOLD OUT",
    availability: "out of stock",
    restockMessage: expectedDate ? `<b>Out until ${expectedDate}</b>` : "",
    dataFeed: "Yes",
    shoppingFeed: "",
    reportFlag: "1",
  };
}

const MANAGED_FIELDS: (keyof ManagedValues)[] = [
  "simpleInventory",
  "availability",
  "restockMessage",
  "dataFeed",
  "shoppingFeed",
  "reportFlag",
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
