import type { VendorRawRow } from "@cozywinters/shared";
import { ValidationError } from "../errors";
import { parseGobiWorkbook } from "./gobiParser";
import { parseGobiWorkbookV2 } from "./gobiParserV2";

/**
 * Registry of versioned parsers. A vendor listed here has more than one way to read its file (usually
 * because the vendor changed its export layout and might change it back). A vendor NOT listed here has a
 * single parser and no version selector. The version an admin picks in Manage Vendors is the one tried
 * first; if it rejects the file, the others are tried in declared order (see parseWithVersions).
 */
export interface ParserVersion {
  /** Stable id stored in the database ("v1", "v2", ...). Never renumber an existing one. */
  version: string;
  /** Short name for the settings dropdown. */
  label: string;
  /** What file layout this version reads, shown next to the dropdown. */
  notes: string;
  parse: (buffer: Buffer) => Promise<{ rows: VendorRawRow[] }> | { rows: VendorRawRow[] };
}

export interface VendorParserSet {
  /** Used when the vendor has no explicit active_parser_version (null in the database). */
  defaultVersion: string;
  versions: ParserVersion[];
}

export const VERSIONED_PARSERS: Record<string, VendorParserSet> = {
  gobi: {
    defaultVersion: "v2",
    versions: [
      {
        version: "v1",
        label: "v1: Ordering SKU layout",
        notes: "Gobi's original layout (through 2026-11-05): GOBI SKU / Ordering SKU / QTY Available columns, about 1,100 rows.",
        parse: parseGobiWorkbook,
      },
      {
        version: "v2",
        label: "v2: Product ID layout",
        notes: "Gobi's layout since 2026-11-06 (Inventory_Report_YYYYMMDD.xlsx): Product ID / UPC / QTY Available columns, about 800 rows.",
        parse: parseGobiWorkbookV2,
      },
    ],
  },
};

export interface ParserVersionOption {
  version: string;
  label: string;
  notes: string;
}

/** The selectable versions for a vendor, or an empty list when it has only one parser (no selector is shown). */
export function listParserVersions(vendorKey: string): ParserVersionOption[] {
  const set = VERSIONED_PARSERS[vendorKey];
  if (!set || set.versions.length < 2) return [];
  return set.versions.map(({ version, label, notes }) => ({ version, label, notes }));
}

export function isKnownParserVersion(vendorKey: string, version: string): boolean {
  return VERSIONED_PARSERS[vendorKey]?.versions.some((v) => v.version === version) ?? false;
}

export interface VersionedParseResult {
  rows: VendorRawRow[];
  /** The version that actually read the file. */
  parserVersion: string;
  /** Set only when the active version rejected the file and another version read it. */
  parserFellBackFrom?: string;
}

/**
 * Reads a vendor file with its versioned parsers.
 * - `forceVersion` (a file already read once, being re-read when a run is created): only that version is
 *   used, never a fallback, so a settings change can't alter how an existing file is interpreted.
 * - otherwise the `active` version (or the vendor default) goes first and the rest follow in declared order.
 * If every version rejects the file, the active version's error is rethrown with the other attempts appended.
 */
export async function parseWithVersions(
  vendorKey: string,
  buffer: Buffer,
  options: { active?: string | null; forceVersion?: string | null } = {},
): Promise<VersionedParseResult> {
  const set = VERSIONED_PARSERS[vendorKey];
  if (!set) throw new ValidationError("PARSER_NOT_VERSIONED", `Vendor "${vendorKey}" has no versioned parsers.`);

  let order: ParserVersion[];
  if (options.forceVersion) {
    const forced = set.versions.find((v) => v.version === options.forceVersion);
    if (!forced) {
      throw new ValidationError("PARSER_VERSION_UNKNOWN", `Parser version "${options.forceVersion}" is not registered for "${vendorKey}".`);
    }
    order = [forced];
  } else {
    const activeId = options.active && isKnownParserVersion(vendorKey, options.active) ? options.active : set.defaultVersion;
    const active = set.versions.find((v) => v.version === activeId)!;
    order = [active, ...set.versions.filter((v) => v !== active)];
  }

  const failures: { version: string; error: unknown }[] = [];
  for (const candidate of order) {
    try {
      const { rows } = await candidate.parse(buffer);
      return {
        rows,
        parserVersion: candidate.version,
        ...(failures.length > 0 ? { parserFellBackFrom: failures[0]!.version } : {}),
      };
    } catch (error) {
      failures.push({ version: candidate.version, error });
    }
  }

  const first = failures[0]!.error;
  if (failures.length === 1) throw first;
  const others = failures
    .slice(1)
    .map((f) => `${f.version}: ${f.error instanceof Error ? f.error.message : String(f.error)}`)
    .join(" | ");
  if (first instanceof ValidationError) {
    throw new ValidationError(first.code, `${first.message} (Parser ${failures[0]!.version} was tried first. Also tried: ${others})`, first.details);
  }
  throw first;
}
