import type { VendorRawRow } from "@cozywinters/shared";
import type { FileKind } from "../db";
import { getRepository, type VendorConfigRecord } from "../db";
import { ValidationError } from "../errors";
import { parseOlliixWorkbook } from "./olliixParser";
import { parseKhWorkbook } from "./khParser";
import { parseGobiWorkbook } from "./gobiParser";
import { parseFieldSheerWorkbook } from "./fieldSheerParser";
import { parseGenericCsv } from "./genericCsvParser";
import { getPluginParser } from "./pluginLoader";

export interface VendorFileAdapter {
  vendorKey: string;
  parse: (buffer: Buffer) => Promise<{ rows: VendorRawRow[] }> | { rows: VendorRawRow[] };
}

/**
 * Maps each built-in ("custom"-shape) vendor FileKind to its hand-written
 * parser and vendor_configs key. These 4 are unaffected by the dynamic
 * ('simple_csv'/'plugin') vendor_configs rows below -- they're always
 * dispatched statically, exactly as before.
 */
export const VENDOR_FILE_ADAPTERS: Partial<Record<FileKind, VendorFileAdapter>> = {
  olliix_workbook: { vendorKey: "olliix", parse: parseOlliixWorkbook },
  kh_workbook: { vendorKey: "kh", parse: parseKhWorkbook },
  gobi_workbook: { vendorKey: "gobi", parse: parseGobiWorkbook },
  fieldsheer_workbook: { vendorKey: "fieldsheer", parse: parseFieldSheerWorkbook },
};

function adapterForDynamicConfig(record: VendorConfigRecord): VendorFileAdapter | undefined {
  if (record.fileShape === "simple_csv" && record.columnMapping) {
    const mapping = record.columnMapping;
    return { vendorKey: record.vendorKey, parse: (buffer) => parseGenericCsv(buffer, mapping) };
  }
  if (record.fileShape === "plugin" && record.pluginFilename) {
    const pluginFilename = record.pluginFilename;
    return {
      vendorKey: record.vendorKey,
      parse: async (buffer) => {
        const plugin = getPluginParser(pluginFilename);
        if (!plugin) {
          throw new ValidationError(
            "PLUGIN_NOT_FOUND",
            `Registered plugin file "${pluginFilename}" for vendor "${record.vendorKey}" was not found on disk.`,
          );
        }
        return plugin.parse(buffer);
      },
    };
  }
  return undefined;
}

/**
 * Looks up the parser adapter for a file already known to be kind
 * "vendor_dynamic", by its vendor_key (built-in FileKinds never reach this
 * path -- see getVendorFileAdapter below).
 */
export async function getDynamicVendorFileAdapter(vendorKey: string): Promise<VendorFileAdapter | undefined> {
  const record = await getRepository().findVendorConfigByKey(vendorKey);
  if (!record || !record.isActive) return undefined;
  return adapterForDynamicConfig(record);
}

/** Built-in ("custom"-shape) vendor FileKinds only -- use getDynamicVendorFileAdapter for "vendor_dynamic" files. */
export function getVendorFileAdapter(kind: FileKind): VendorFileAdapter | undefined {
  return VENDOR_FILE_ADAPTERS[kind];
}

export interface VendorFileDetectionResult {
  vendorKey: string;
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
 * parse). Tries the 4 built-in vendors first (unchanged order/behavior),
 * then any active 'simple_csv'/'plugin' vendor_configs row.
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

  const dynamicConfigs = (await getRepository().listVendorConfigs()).filter(
    (c) => c.isActive && (c.fileShape === "simple_csv" || c.fileShape === "plugin"),
  );
  for (const record of dynamicConfigs) {
    const adapter = adapterForDynamicConfig(record);
    if (!adapter) continue;
    try {
      const { rows } = await adapter.parse(buffer);
      return { vendorKey: record.vendorKey, fileKind: "vendor_dynamic", rows };
    } catch (err) {
      errors.push(`${record.vendorKey}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new ValidationError(
    "VENDOR_NOT_DETECTED",
    "Could not identify which vendor this file belongs to. It didn't match any known vendor's expected file format.",
    { attempts: errors },
  );
}
