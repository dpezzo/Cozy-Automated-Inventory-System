import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteRepository } from "../db/sqliteRepository";
import { EMPTY_CATALOG_VIEW_CONFIG, type CatalogViewConfig } from "@cozywinters/shared";

// Real SQLite (migrations included), so the tables, the visibility query and the default rules are exercised for real.
let repo: SqliteRepository;
vi.mock("node:sqlite", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(__filename)("node:sqlite");
});
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getRepository: () => repo,
}));

import {
  listCatalogViews,
  createCatalogView,
  updateCatalogView,
  deleteCatalogView,
  setCatalogViewDefault,
  type CatalogViewActor,
} from "./catalogViewService";

let tmp: string;
let admin: CatalogViewActor;
let cale: CatalogViewActor;
let dan: CatalogViewActor;

const CONFIG: CatalogViewConfig = {
  ...EMPTY_CATALOG_VIEW_CONFIG,
  hiddenColumns: ["thumbnail", "productUrl"],
  columnFilters: { vendor: ["Olliix"] },
  sortKey: "brand",
};

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "catalog-views-"));
  repo = new SqliteRepository(path.join(tmp, "test.db"));
  await repo.init();
  const make = async (email: string, role: "admin" | "member"): Promise<CatalogViewActor> => ({
    userId: (await repo.createUser({ email, role, passwordHash: "x" })).id,
    role,
  });
  admin = await make("darren@example.com", "admin");
  cale = await make("cale@example.com", "member");
  dan = await make("dan@example.com", "member");
});
afterAll(async () => {
  await repo.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("catalog views", () => {
  it("a new view is private to its owner and round-trips its columns, filters and sort", async () => {
    const created = await createCatalogView(cale, { name: "  Olliix   check ", config: CONFIG });
    expect(created).toMatchObject({ name: "Olliix check", isShared: false, isMine: true, canEdit: true });
    expect((await listCatalogViews(cale)).views.map((v) => v.name)).toContain("Olliix check");
    expect((await listCatalogViews(dan)).views.map((v) => v.name)).not.toContain("Olliix check");
    expect((await listCatalogViews(cale)).views.find((v) => v.id === created.id)!.config).toEqual(CONFIG);
  });

  it("sharing makes it visible to others, read-only for them, and still editable by an admin", async () => {
    const view = (await listCatalogViews(cale)).views.find((v) => v.name === "Olliix check")!;
    await updateCatalogView(cale, view.id, { isShared: true });
    const seenByDan = (await listCatalogViews(dan)).views.find((v) => v.id === view.id)!;
    expect(seenByDan).toMatchObject({ isMine: false, canEdit: false, ownerLabel: "cale@example.com" });
    await expect(updateCatalogView(dan, view.id, { name: "Mine now" })).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(deleteCatalogView(dan, view.id)).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(updateCatalogView(admin, view.id, { name: "Olliix check (team)" })).resolves.toMatchObject({ name: "Olliix check (team)" });
  });

  it("someone else's private view looks like it doesn't exist", async () => {
    const priv = await createCatalogView(cale, { name: "Private one", config: CONFIG });
    await expect(updateCatalogView(dan, priv.id, { name: "x" })).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(setCatalogViewDefault(dan, "personal", priv.id)).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("rejects blank, too-long, duplicate and built-in names, and malformed settings", async () => {
    await expect(createCatalogView(dan, { name: "   ", config: CONFIG })).rejects.toMatchObject({ code: "INVALID_VIEW_NAME" });
    await expect(createCatalogView(dan, { name: "x".repeat(61), config: CONFIG })).rejects.toMatchObject({ code: "INVALID_VIEW_NAME" });
    await expect(createCatalogView(dan, { name: "all columns", config: CONFIG })).rejects.toMatchObject({ code: "VIEW_NAME_TAKEN" });
    await createCatalogView(dan, { name: "Dupe", config: CONFIG });
    await expect(createCatalogView(dan, { name: "DUPE", config: CONFIG })).rejects.toMatchObject({ code: "VIEW_NAME_TAKEN" });
    // The same name under a different owner is fine.
    await expect(createCatalogView(cale, { name: "Dupe", config: CONFIG })).resolves.toMatchObject({ name: "Dupe" });
    await expect(createCatalogView(dan, { name: "Bad", config: { version: 2 } })).rejects.toMatchObject({ code: "INVALID_VIEW_CONFIG" });
    await expect(createCatalogView(dan, { name: "Bad", config: { ...CONFIG, columnWidths: { a: -5 } } })).rejects.toMatchObject({
      code: "INVALID_VIEW_CONFIG",
    });
  });

  it("anyone can set their own default; only an admin sets the team default, and it must be shared", async () => {
    const shared = (await listCatalogViews(cale)).views.find((v) => v.isShared)!;
    const priv = (await listCatalogViews(cale)).views.find((v) => v.name === "Private one")!;

    await setCatalogViewDefault(dan, "personal", shared.id);
    expect((await listCatalogViews(dan)).defaults.personal).toBe(shared.id);
    await setCatalogViewDefault(dan, "personal", "builtin:all");
    expect((await listCatalogViews(dan)).defaults.personal).toBe("builtin:all");

    await expect(setCatalogViewDefault(dan, "team", shared.id)).rejects.toMatchObject({ name: "ForbiddenError" });
    // An admin can't reach someone else's private view at all, and their own private view can't become the team default.
    await expect(setCatalogViewDefault(admin, "team", priv.id)).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(updateCatalogView(admin, priv.id, { name: "x" })).rejects.toMatchObject({ name: "NotFoundError" });
    const adminsOwn = await createCatalogView(admin, { name: "Admin private", config: CONFIG });
    await expect(setCatalogViewDefault(admin, "team", adminsOwn.id)).rejects.toMatchObject({ code: "VIEW_NOT_SHARED" });
    await setCatalogViewDefault(admin, "team", shared.id);
    expect((await listCatalogViews(dan)).defaults.team).toBe(shared.id);
    await expect(setCatalogViewDefault(admin, "bogus", null)).rejects.toMatchObject({ code: "INVALID_DEFAULT_SCOPE" });
  });

  it("unsharing the team default, or deleting a view, clears every default that pointed at it", async () => {
    const shared = (await listCatalogViews(cale)).views.find((v) => v.isShared)!;
    await setCatalogViewDefault(dan, "personal", shared.id);
    await updateCatalogView(cale, shared.id, { isShared: false });
    expect((await listCatalogViews(dan)).defaults).toEqual({ personal: null, team: null });

    await setCatalogViewDefault(cale, "personal", shared.id);
    await deleteCatalogView(cale, shared.id);
    expect((await listCatalogViews(cale)).defaults.personal).toBeNull();
    expect((await listCatalogViews(cale)).views.find((v) => v.id === shared.id)).toBeUndefined();
  });

  it("lists the built-in views", async () => {
    expect((await listCatalogViews(dan)).builtins.map((b) => b.id)).toEqual(["builtin:all"]);
  });
});
