import { getRepository, type FileRecord, type UpsertDiscontinuedItemsResult } from "../db";
import type { ParsedDiscontinuedList } from "../vendor/discontinuedListParser";

/**
 * The one vendor whose discontinued list we receive today (Alex at Olliix emails it). The list is stored per
 * vendor_key so another vendor could adopt it later, but the run pipeline treats exactly this vendor as
 * "list-driven" (see runPipeline.ts), so both places share this constant.
 */
export const DISCONTINUED_LIST_VENDOR_KEY = "olliix";

export interface DiscontinuedImportResult extends UpsertDiscontinuedItemsResult {
  /** Rows in the file that could not be used (blank/non-numeric UPC), for the upload message. */
  skipped: number;
  vendorKey: string;
}

/** Merges a parsed notification into the cumulative list. Never deletes: an item stays discontinued until removed deliberately. */
export async function importDiscontinuedList(
  parsed: ParsedDiscontinuedList,
  file: FileRecord,
  userId: string,
): Promise<DiscontinuedImportResult> {
  const repo = getRepository();
  const { added, updated } = await repo.upsertDiscontinuedItems(DISCONTINUED_LIST_VENDOR_KEY, parsed.items, file.id);
  await repo.insertAuditLog({
    actorId: userId,
    action: "DISCONTINUED_LIST_IMPORTED",
    entityType: "file",
    entityId: file.id,
    details: { vendorKey: DISCONTINUED_LIST_VENDOR_KEY, added, updated, skipped: parsed.skippedRows.length },
  });
  return { added, updated, skipped: parsed.skippedRows.length, vendorKey: DISCONTINUED_LIST_VENDOR_KEY };
}
