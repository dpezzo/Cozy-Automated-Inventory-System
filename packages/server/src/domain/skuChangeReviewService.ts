import { getRepository } from "../db";
import { ValidationError } from "../errors";
import { rowsToXlsx } from "../csv/writeXlsx";
import { readStoredFileText } from "../storage/fileStorage";
import { parseRunningChangeWorkbook } from "../vendor/runningChangeParser";
import { parseOlliixWorkbook } from "../vendor/olliixParser";
import { parseDiscontinuedListWorkbook } from "../vendor/discontinuedListParser";
import { parseMivaSnapshotCsv } from "../vendor/mivaCsv";
import { buildSkuChangeReview, skuChangeRowColor, SKU_CHANGE_REVIEW_HEADERS } from "./skuChangeReview";

export interface SkuChangeReviewResult {
  xlsx: Buffer;
  counts: { rename: number; hold: number; skip: number };
  mivaSnapshotFileId: string;
}

/**
 * Builds the Olliix "SKU change review" workbook from three uploaded files plus the newest stored
 * Miva snapshot. Read-only: nothing is stored or pushed; the workbook goes back to the caller to
 * review with Cale before any SKU or MPN is changed in Miva.
 */
export async function generateSkuChangeReview(files: {
  runningChange: Buffer;
  dealerInventory: Buffer;
  discontinued: Buffer;
}): Promise<SkuChangeReviewResult> {
  const snapshots = (await getRepository().listFiles("miva_snapshot")).filter((f) => f.rowCount !== null);
  const latest = [...snapshots].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
  if (!latest) throw new ValidationError("MIVA_SNAPSHOT_REQUIRED", "Pull or upload a Miva snapshot first; none is stored.");

  const changes = await parseRunningChangeWorkbook(files.runningChange);
  const dealer = await parseOlliixWorkbook(files.dealerInventory);
  const discontinued = await parseDiscontinuedListWorkbook(files.discontinued);
  const miva = parseMivaSnapshotCsv(readStoredFileText(latest.storagePath));

  const rows = buildSkuChangeReview({
    changes,
    miva: miva.rows.map((m) => ({ productCode: m.productCode, gtinRaw: m.gtinRaw, mpnRaw: m.mpnRaw })),
    dealerItems: dealer.rows.map((r) => ({ itemNo: r.itemNoRaw ?? "", totalQtyRaw: r.totalQtyRaw })),
    discontinuedItemNos: discontinued.items.map((i) => i.itemNo ?? ""),
  });

  const xlsx = await rowsToXlsx(rows, [...SKU_CHANGE_REVIEW_HEADERS], {
    sanitizeFormulas: true,
    sheetName: "SKU Change Review",
    numericColumns: ["OLD_SKU_QTY", "NEW_SKU_QTY"],
    rowFillColors: rows.map(skuChangeRowColor),
  });
  return {
    xlsx,
    mivaSnapshotFileId: latest.id,
    counts: {
      rename: rows.filter((r) => r.PROPOSED_ACTION === "RENAME").length,
      hold: rows.filter((r) => r.PROPOSED_ACTION === "HOLD").length,
      skip: rows.filter((r) => r.PROPOSED_ACTION === "SKIP").length,
    },
  };
}
