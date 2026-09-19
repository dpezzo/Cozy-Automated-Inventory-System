import type { VendorRawRow } from "@cozywinters/shared";
import type { VendorKey } from "@cozywinters/shared";
import type { FileKind } from "../db";
import { ValidationError } from "../errors";
import { parseOlliixWorkbook } from "./olliixParser";
import { parseKhWorkbook } from "./khParser";
import { parseGobiWorkbook } from "./gobiParser";
import { parseFieldSheerWorkbook } from "./fieldSheerParser";

export interface VendorFileAdapter {
  vendorKey: VendorKey;
  parse: (buffer: Buffer) => Promise<{ rows: VendorRawRow[] }> | { rows: VendorRawRow[] };
}

/**
 * Maps each vendor FileKind to its parser and vendor registry key. This is
 * the one place a new vendor's upload/parse dispatch is wired in --
 * uploadService.ts and runService.ts both look files up here instead of
 * hardcoding a per-vendor if/else chain.
 */
export const VENDOR_FILE_ADAPTERS: Partial<Record<FileKind, VendorFileAdapter>> = {
  olliix_workbook: { vendorKey: "olliix", parse: parseOlliixWorkbook },
  kh_workbook: { vendorKey: "kh", parse: parseKhWorkbook },
  gobi_workbook: { vendorKey: "gobi", parse: parseGobiWorkbook },
  fieldsheer_workbook: { vendorKey: "fieldsheer", parse: parseFieldSheerWorkbook },
};

export function getVendorFileAdapter(kind: FileKind): VendorFileAdapter | undefined {
  return VENDOR_FILE_ADAPTERS[kind];
}

export interface VendorFileDetectionResult {
  vendorKey: VendorKey;
  fileKind: FileKind;
  rows: VendorRawRow[];
}

/**
 * Detects which vendor a file belongs to purely from its own content --
 * never the filename -- by attempting each vendor's own parser in turn and
 * taking the first one that doesn't throw. Reuses each parser's existing
 * required-sheet-name / required-header validation as the detection
 * signature, so there is no separate "sniff" logic to keep in sync, and the
 * successful attempt's already-parsed rows are reused directly (no second
 * parse). Verified against the four real vendor files: none of them
 * accidentally satisfies another's requirements, so attempt order does not
 * matter among the vendors registered today -- see the note in the project
 * plan about what's required when a new vendor is onboarded.
 */
export async function detectVendorFile(buffer: Buffer): Promise<VendorFileDetectionResult> {
  const errors: string[] = [];
  for (const [fileKind, adapter] of Object.entries(VENDOR_FILE_ADAPTERS) as [FileKind, VendorFileAdapter][]) {
    try {
      const { rows } = await adapter.parse(buffer);
      return { vendorKey: adapter.vendorKey, fileKind, rows };
    } catch (err) {
      errors.push(`${fileKind}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new ValidationError(
    "VENDOR_NOT_DETECTED",
    "Could not identify which vendor this file belongs to. It didn't match any known vendor's expected file format.",
    { attempts: errors },
  );
}
