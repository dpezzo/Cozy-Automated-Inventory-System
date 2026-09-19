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
): { productUrl: string; thumbnailUrl: string } {
  const link = get("canonicalUrl") || get("link");
  const variantSelect = get("variantSelect");
  const productUrl = link ? (variantSelect ? `${link}?${variantSelect}` : link) : "";

  const imagePath = product.thumbnail || product.image || "";
  let thumbnailUrl = "";
  if (imagePath && link) {
    try {
      const mountPath = getMivaMountPath();
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

function toPhysicalRow(product: MivaApiProduct): PhysicalMivaRow {
  const get = (field: Parameters<typeof readCustomFieldValue>[1]) =>
    readCustomFieldValue(product.CustomField_Values, field);
  const { productUrl, thumbnailUrl } = buildUrlAndThumbnail(get, product);
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
    "SHOW_IN_DARREN_INVENTORY_REPORT_(1)": get("reportFlag"),
    PRODUCT_TYPE: get("productType"),
    PRODUCT_URL: productUrl,
    PRODUCT_THUMBNAIL: thumbnailUrl,
  };
}

/**
 * Pages through ProductList_Load_Query for the full catalog, including
 * inventory and every custom field. Field-level mapping into the app's
 * managed columns is via mivaFieldMap.ts (module/field codes confirmed
 * against the development store).
 */
export async function fetchAllMivaProductsAsPhysicalRows(): Promise<PhysicalMivaRow[]> {
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
          value: ["CustomField_Values:*"],
        },
      ],
    })) as unknown as ProductListLoadQueryResponse;

    const page = response.data.data;
    for (const product of page) rows.push(toPhysicalRow(product));

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
  const physicalRows = await fetchAllMivaProductsAsPhysicalRows();
  const csv = rowsToCsv(physicalRows, PHYSICAL_HEADERS);
  const buffer = Buffer.from(csv, "utf8");
  const filename = `miva-api-pull-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;

  const result = await uploadFile(buffer, filename, "miva_snapshot", userId, false);

  await getRepository().insertAuditLog({
    actorId: userId,
    action: "MIVA_SNAPSHOT_PULLED_VIA_API",
    entityType: "file",
    entityId: result.file.id,
    details: { rowCount: physicalRows.length },
  });

  return result;
}
