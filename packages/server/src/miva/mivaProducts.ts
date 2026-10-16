import { rowsToCsv } from "../csv/writeCsv";
import { MIVA_HEADER_MAP } from "../vendor/mivaCsv";
import { readCustomFieldValue } from "./mivaFieldMap";
import { callMivaApi, getMivaMountPath } from "./mivaApiClient";
import { uploadFile, type UploadResult } from "../domain/uploadService";
import { getRepository } from "../db";

interface MivaApiProduct {
  code: string;
  name: string;
  thumbnail?: string;
  image?: string;
  // Confirmed against Miva's JSON API docs: a top-level Boolean field, always present (not an
  // on-demand column).
  active?: boolean | string;
  // Confirmed against Miva's JSON API docs: a Number field (on-hand inventory count,
  // CURRENT_STOCK_LEVEL in a manual CSV export) plus a sibling Boolean field,
  // product_inventory_active (whether inventory tracking is turned on for this product). Both
  // are returned only when "product_inventory" is requested as an ondemandcolumn (see the
  // Filter below) -- otherwise silently omitted.
  product_inventory?: number | string;
  product_inventory_active?: boolean | string;
  CustomField_Values?: Record<string, Record<string, unknown>>;
}

/**
 * Builds the product page URL and a small preview image URL for one product.
 * For a Variant record, the "link" custom field already resolves to its
 * PARENT product's page (confirmed against the development store: variant
 * "BGA-LG"'s link pointed to "bga.html", the "BGA" parent's page) -- no
 * separate parent-code lookup is needed. "variant_select" (e.g. "VS=BGA-LG")
 * is appended when present so the link deep-links to that exact variant's
 * selection on the parent page rather than just the parent's default view.
 */
function buildUrlAndThumbnail(
  get: (field: Parameters<typeof readCustomFieldValue>[1]) => string,
  product: MivaApiProduct,
  mountPath: string,
): { productUrl: string; thumbnailUrl: string } {
  const link = get("canonicalUrl") || get("link");
  const variantSelect = get("variantSelect");
  const productUrl = link ? (variantSelect ? `${link}?${variantSelect}` : link) : "";

  const imagePath = product.thumbnail || product.image || "";
  let thumbnailUrl = "";
  if (imagePath && link) {
    try {
      thumbnailUrl = `${new URL(link).origin}${mountPath}/${imagePath.replace(/^\/+/, "")}`;
    } catch {
      thumbnailUrl = "";
    }
  }
  return { productUrl, thumbnailUrl };
}

interface ProductListLoadQueryResponse {
  data: {
    total_count: number;
    data: MivaApiProduct[];
  };
}

const PAGE_SIZE = 500;

/** One physical CSV row, keyed by Miva's own export header strings (see vendor/mivaCsv.ts MIVA_HEADER_MAP). */
type PhysicalMivaRow = Record<string, string>;

function toPhysicalRow(product: MivaApiProduct, mountPath: string): PhysicalMivaRow {
  const get = (field: Parameters<typeof readCustomFieldValue>[1]) =>
    readCustomFieldValue(product.CustomField_Values, field);
  const { productUrl, thumbnailUrl } = buildUrlAndThumbnail(get, product, mountPath);
  return {
    PRODUCT_CODE: product.code ?? "",
    PRODUCT_NAME: product.name ?? "",
    "*DF-GTIN": get("gtin"),
    "*DF-MPN": get("mpn"),
    "*DF-PRODUCT_BRAND": get("brand"),
    "*CUSTOM_SIMPLE_INVENTORY": get("simpleInventory"),
    "*DF-AVAILABILITY": get("availability"),
    "*ORD-INV_RESTOCK_DATE_DF-MERG-IN:": get("restockMessage"),
    "*DF-DATAFEED": get("dataFeed"),
    "*DF-SHOPPING_FEED": get("shoppingFeed"),
    DROPSHIP_INVENTORY_MANAGEMENT: get("dsInvMgt"),
    PRODUCT_TYPE: get("productType"),
    PRODUCT_URL: productUrl,
    PRODUCT_THUMBNAIL: thumbnailUrl,
    ACTIVE: product.active === undefined ? "" : String(product.active),
    PARENT_CODE: get("parentCode"),
    CURRENT_STOCK_LEVEL: product.product_inventory === undefined ? "" : String(product.product_inventory),
    TRACK_INVENTORY:
      product.product_inventory_active === undefined ? "" : String(product.product_inventory_active),
  };
}

/**
 * Pages through ProductList_Load_Query for the full catalog, including
 * inventory and every custom field. Field-level mapping into the app's
 * managed columns is via mivaFieldMap.ts (module/field codes confirmed
 * against the development store).
 */
export async function fetchAllMivaProductsAsPhysicalRows(): Promise<PhysicalMivaRow[]> {
  const mountPath = await getMivaMountPath();
  const rows: PhysicalMivaRow[] = [];
  let offset = 0;
  for (;;) {
    const response = (await callMivaApi({
      Function: "ProductList_Load_Query",
      Count: PAGE_SIZE,
      Offset: offset,
      Filter: [
        {
          name: "ondemandcolumns",
          // "product_inventory" is also an on-demand column (confirmed against Miva's JSON API
          // docs) -- without it, Miva silently omits product_inventory/product_inventory_active
          // from every record rather than erroring, which is why requesting it unconditionally
          // previously returned blank stock levels for every row.
          value: ["CustomField_Values:*", "product_inventory"],
        },
      ],
    })) as unknown as ProductListLoadQueryResponse;

    const page = response.data.data;
    for (const product of page) rows.push(toPhysicalRow(product, mountPath));

    offset += page.length;
    if (page.length < PAGE_SIZE || offset >= response.data.total_count) break;
  }
  return rows;
}

/** Physical CSV headers, in the exact order/casing Miva's own export uses (mirrors MIVA_HEADER_MAP's keys). */
const PHYSICAL_HEADERS = Object.keys(MIVA_HEADER_MAP);

/**
 * Pulls the full Miva catalog via the JSON API, serializes it into the same
 * physical CSV shape a manually-exported Miva snapshot has, and stores it
 * through the existing upload pipeline (uploadService.uploadFile) so the
 * reconciliation pipeline needs no changes to accept an API-sourced snapshot.
 */
export async function pullMivaSnapshotFromApi(userId: string): Promise<UploadResult> {
  // Captured up front -- the same value callMivaApi() itself reads to pick
  // credentials for this pull -- and recorded on the file so the Home/Catalog
  // page snapshot pickers can filter to only the currently active site.
  const sourceSite = await getRepository().getMivaActiveSite();
  const physicalRows = await fetchAllMivaProductsAsPhysicalRows();
  const csv = rowsToCsv(physicalRows, PHYSICAL_HEADERS);
  const buffer = Buffer.from(csv, "utf8");
  const filename = `miva-api-pull-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;

  const result = await uploadFile(buffer, filename, "miva_snapshot", userId, false, sourceSite);

  await getRepository().insertAuditLog({
    actorId: userId,
    action: "MIVA_SNAPSHOT_PULLED_VIA_API",
    entityType: "file",
    entityId: result.file.id,
    details: { rowCount: physicalRows.length, sourceSite },
  });

  return result;
}
