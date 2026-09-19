/**
 * Maps the app's six managed logical fields to Miva JSON API custom-field
 * module/field codes. These codes are store-specific and are NOT the same
 * strings as the Miva CSV export headers in vendor/mivaCsv.ts.
 *
 * To discover the real codes: call ProductList_Load_Query for one known
 * product with an "ondemandcolumns" filter value of "CustomField_Values:*",
 * then read the module_code/field_code keys off the returned
 * CustomField_Values object and fill them in below. Placeholders below are
 * unconfirmed and MUST be verified against the development store before
 * Phase A's API pull is trusted, and before any Phase B write.
 */
export interface MivaFieldCode {
  moduleCode: string;
  fieldCode: string;
}

export type MivaLogicalField =
  | "gtin"
  | "mpn"
  | "brand"
  | "simpleInventory"
  | "availability"
  | "restockMessage"
  | "dataFeed"
  | "shoppingFeed"
  | "reportFlag"
  | "productType"
  | "link"
  | "canonicalUrl"
  | "variantSelect";

/**
 * NOTE: gtin/mpn/brand are match-critical (the reconciliation engine's exact
 * UPC-to-GTIN matching depends on gtin), not cosmetic — they must be mapped
 * and confirmed with the same rigor as the six managed fields before the API
 * pull is trusted for a real run.
 *
 * Confirmed 2026-09-19 against the CozyWinters development store via
 * ProductList_Load_Query with CustomField_Values:* on a sample product. All
 * eight live under the single "customfields" module.
 */
export const MIVA_CUSTOM_FIELD_MAP: Record<MivaLogicalField, MivaFieldCode> = {
  gtin: { moduleCode: "customfields", fieldCode: "gtin" },
  mpn: { moduleCode: "customfields", fieldCode: "mpn" },
  brand: { moduleCode: "customfields", fieldCode: "brand" },
  simpleInventory: { moduleCode: "customfields", fieldCode: "simple_inventory" },
  availability: { moduleCode: "customfields", fieldCode: "feed_availability" },
  restockMessage: { moduleCode: "customfields", fieldCode: "supplier_restock_date" },
  dataFeed: { moduleCode: "customfields", fieldCode: "datafeed" },
  shoppingFeed: { moduleCode: "customfields", fieldCode: "shopping_feed" },
  reportFlag: { moduleCode: "customfields", fieldCode: "dp_inv_rpt" },
  productType: { moduleCode: "customfields", fieldCode: "productType" },
  // link already resolves to the PARENT product's page for a Variant record
  // (confirmed 2026-09-19: variant "BGA-LG"'s link pointed to "bga.html", the
  // parent "BGA"'s page) -- no separate parent-code lookup is needed.
  link: { moduleCode: "customfields", fieldCode: "link" },
  canonicalUrl: { moduleCode: "customfields", fieldCode: "canonicalprodurl" },
  // Deep-links to the exact variant selection on the parent's page, e.g. "VS=BGA-LG".
  variantSelect: { moduleCode: "customfields", fieldCode: "variant_select" },
};

/** The ondemandcolumns filter value that asks Miva to include every custom field on each product. */
export const CUSTOM_FIELD_ONDEMAND_COLUMN = "CustomField_Values:*";

export function readCustomFieldValue(
  customFieldValues: Record<string, Record<string, unknown>> | undefined,
  logicalField: keyof typeof MIVA_CUSTOM_FIELD_MAP,
): string {
  const code = MIVA_CUSTOM_FIELD_MAP[logicalField];
  const value = customFieldValues?.[code.moduleCode]?.[code.fieldCode];
  return value === null || value === undefined ? "" : String(value);
}

/** Shape of a single Product_Update Iteration's CustomField_Values payload for the six managed fields. */
export function buildCustomFieldValuesPayload(values: {
  availability?: string;
  restockMessage?: string;
  dataFeed?: string;
  shoppingFeed?: string;
  reportFlag?: string;
}): Record<string, Record<string, string>> {
  const payload: Record<string, Record<string, string>> = {};
  for (const [logicalField, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const code = MIVA_CUSTOM_FIELD_MAP[logicalField as keyof typeof MIVA_CUSTOM_FIELD_MAP];
    payload[code.moduleCode] ??= {};
    payload[code.moduleCode]![code.fieldCode] = value;
  }
  return payload;
}
