import fs from "node:fs";
import path from "node:path";
import { defaultVendorPluginsDir, vendorPluginsSeedDir } from "../config/paths";

/**
 * Copies any .js file checked into vendor-plugins-seed/ into the runtime
 * vendor-plugins directory, skipping files that already exist there -- so a
 * plugin edited or dropped in by hand on a given server is never clobbered
 * by a redeploy. Run on every boot (see migrate.ts) so a plugin reaches
 * production the same way everything else does: committed to git, deployed
 * by a normal push, instead of a manual copy onto the server/volume.
 */
export function seedVendorPluginFiles(): void {
  const seedDir = vendorPluginsSeedDir();
  if (!fs.existsSync(seedDir)) return;
  const targetDir = defaultVendorPluginsDir();
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of fs.readdirSync(seedDir)) {
    if (!file.endsWith(".js")) continue;
    const dest = path.join(targetDir, file);
    if (fs.existsSync(dest)) continue;
    fs.copyFileSync(path.join(seedDir, file), dest);
  }
}
