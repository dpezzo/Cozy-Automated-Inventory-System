import fs from "node:fs";
import path from "node:path";
import type { VendorRawRow } from "@cozywinters/shared";
import { defaultVendorPluginsDir } from "../config/paths";

/**
 * The shape a parser plugin file must export as its module.exports (or
 * `exports.parse`). Identical to VendorFileAdapter.parse's shape in
 * vendorFileRegistry.ts -- a plugin is just a parser, dynamically loaded
 * from disk instead of imported at build time.
 */
export interface VendorPluginParser {
  parse(buffer: Buffer): Promise<{ rows: VendorRawRow[] }>;
}

function ensurePluginsDir(): string {
  const dir = defaultVendorPluginsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Lists .js files sitting in the plugins directory that aren't already
 * registered as some vendor_configs row's plugin_filename. No route ever
 * writes a file here -- files only arrive by an admin/developer placing them
 * directly on the filesystem; this only reads what's already there.
 */
export function listAvailablePluginFiles(alreadyRegistered: Set<string>): string[] {
  const dir = ensurePluginsDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js") && !alreadyRegistered.has(f))
    .sort();
}

/**
 * require()s a plugin file fresh (or from Node's require cache -- see
 * reloadPlugins() for busting it after an edit) and validates its shape.
 * `filename` is basename-only, never a path -- rejects any traversal
 * attempt outright rather than resolving it.
 */
export function getPluginParser(filename: string): VendorPluginParser | null {
  const safeName = path.basename(filename);
  if (safeName !== filename || !safeName.endsWith(".js")) return null;
  const dir = defaultVendorPluginsDir();
  const fullPath = path.join(dir, safeName);
  if (!fs.existsSync(fullPath)) return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(fullPath) as { parse?: (buffer: Buffer) => Promise<{ rows: VendorRawRow[] }> };
  if (typeof mod.parse !== "function") return null;
  return { parse: mod.parse };
}

/**
 * Clears Node's require cache for every file under the plugins directory, so
 * an edited plugin is picked up on the next getPluginParser() call without a
 * full server restart. Backs POST /vendors/reload-plugins.
 */
export function reloadPlugins(): void {
  const dir = path.resolve(defaultVendorPluginsDir());
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(dir + path.sep)) delete require.cache[key];
  }
}
