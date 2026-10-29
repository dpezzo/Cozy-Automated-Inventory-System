import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteRepository } from "../db/sqliteRepository";

// Real SQLite (migrations included) so the app_settings round trip is exercised for real.
let repo: SqliteRepository;
vi.mock("node:sqlite", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(__filename)("node:sqlite");
});
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getRepository: () => repo,
}));

import { getFeatureFlags, setFeatureFlags, assertFeatureEnabled, isFeatureEnabled } from "./featureFlags";

let tmp: string;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "feature-flags-"));
  repo = new SqliteRepository(path.join(tmp, "test.db"));
  await repo.init();
});
afterAll(async () => {
  await repo.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("feature flags", () => {
  it("saved Catalog views are off by default, and the guard refuses with a helpful message", async () => {
    expect(await getFeatureFlags()).toEqual({ catalogViews: false });
    await expect(assertFeatureEnabled("catalogViews")).rejects.toMatchObject({
      name: "ForbiddenError",
      message: expect.stringContaining("Settings > Features"),
    });
  });

  it("turning it on persists and lets the guard through; turning it off closes it again", async () => {
    const on = await setFeatureFlags({ catalogViews: true });
    expect(on).toEqual({ changed: { catalogViews: true }, flags: { catalogViews: true } });
    expect(await isFeatureEnabled("catalogViews")).toBe(true);
    await expect(assertFeatureEnabled("catalogViews")).resolves.toBeUndefined();
    expect(await repo.getAppSetting("feature_catalog_views")).toBe("true");

    await setFeatureFlags({ catalogViews: false });
    await expect(assertFeatureEnabled("catalogViews")).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("rejects unknown features and non-boolean values without changing anything", async () => {
    await expect(setFeatureFlags({ bogus: true })).rejects.toMatchObject({ code: "INVALID_FEATURES" });
    await expect(setFeatureFlags({ catalogViews: "yes" })).rejects.toMatchObject({ code: "INVALID_FEATURES" });
    await expect(setFeatureFlags(null)).rejects.toMatchObject({ code: "INVALID_FEATURES" });
    expect(await getFeatureFlags()).toEqual({ catalogViews: false });
  });
});
