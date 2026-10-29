import { BUILTIN_CATALOG_VIEWS, isBuiltinCatalogViewId, parseCatalogViewConfig, type CatalogViewConfig } from "@cozywinters/shared";
import { getRepository, type CatalogViewRecord } from "../db";
import { ValidationError, ForbiddenError, NotFoundError } from "../errors";

/** Who is asking. Role comes from the session, never the request body. */
export interface CatalogViewActor {
  userId: string;
  role: "admin" | "member";
}

export interface CatalogViewDto {
  id: string;
  name: string;
  ownerUserId: string;
  /** Display name or email of the owner, so a shared view can say who made it. */
  ownerLabel: string;
  isShared: boolean;
  /** True when the caller owns it; an admin can still change a view they don't own. */
  isMine: boolean;
  canEdit: boolean;
  config: CatalogViewConfig;
  updatedAt: string;
}

export interface CatalogViewsPayload {
  views: CatalogViewDto[];
  /** Built-in views the page always offers; ids are stable strings like "builtin:all". */
  builtins: { id: string; name: string; config: CatalogViewConfig }[];
  /** The view id that opens by default for this person, and for the team. Null when unset or when it no longer exists. */
  defaults: { personal: string | null; team: string | null };
}

const MAX_NAME_LENGTH = 60;

function canModify(actor: CatalogViewActor, view: CatalogViewRecord): boolean {
  return actor.role === "admin" || view.ownerUserId === actor.userId;
}

function cleanName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (name === "") throw new ValidationError("INVALID_VIEW_NAME", "A view needs a name.");
  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError("INVALID_VIEW_NAME", `A view name can be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return name;
}

function requireConfig(raw: unknown): CatalogViewConfig {
  const config = parseCatalogViewConfig(raw);
  if (!config) throw new ValidationError("INVALID_VIEW_CONFIG", "The view's settings were not in a recognized format.");
  return config;
}

/** One person can't have two views with the same name (case-insensitive), and nobody can reuse a built-in view's name. */
async function assertNameAvailable(ownerUserId: string, name: string, exceptViewId?: string): Promise<void> {
  const lower = name.toLowerCase();
  if (BUILTIN_CATALOG_VIEWS.some((b) => b.name.toLowerCase() === lower)) {
    throw new ValidationError("VIEW_NAME_TAKEN", `"${name}" is the name of a built-in view. Choose a different name.`);
  }
  const mine = (await getRepository().listCatalogViewsVisibleTo(ownerUserId)).filter((v) => v.ownerUserId === ownerUserId);
  if (mine.some((v) => v.id !== exceptViewId && v.name.toLowerCase() === lower)) {
    throw new ValidationError("VIEW_NAME_TAKEN", `You already have a view named "${name}".`);
  }
}

async function loadOwnedOrThrow(actor: CatalogViewActor, id: string): Promise<CatalogViewRecord> {
  const view = await getRepository().findCatalogViewById(id);
  // A private view that isn't yours is reported as missing, not forbidden, even to an admin: it was never shared with anyone.
  if (!view || (!view.isShared && view.ownerUserId !== actor.userId)) {
    throw new NotFoundError("That view was not found.");
  }
  if (!canModify(actor, view)) {
    throw new ForbiddenError("Only the view's owner or an admin can change it. Use Save as copy to keep your own version.");
  }
  return view;
}

function personalScope(userId: string): string {
  return `user:${userId}`;
}

async function toDtos(actor: CatalogViewActor, views: CatalogViewRecord[]): Promise<CatalogViewDto[]> {
  const repo = getRepository();
  const ownerLabels = new Map<string, string>();
  for (const ownerId of new Set(views.map((v) => v.ownerUserId))) {
    const owner = await repo.findUserById(ownerId);
    ownerLabels.set(ownerId, owner?.displayName?.trim() || owner?.email || "Unknown user");
  }
  return views.map((v) => ({
    id: v.id,
    name: v.name,
    ownerUserId: v.ownerUserId,
    ownerLabel: ownerLabels.get(v.ownerUserId) ?? "Unknown user",
    isShared: v.isShared,
    isMine: v.ownerUserId === actor.userId,
    canEdit: canModify(actor, v),
    config: v.config,
    updatedAt: v.updatedAt,
  }));
}

export async function listCatalogViews(actor: CatalogViewActor): Promise<CatalogViewsPayload> {
  const repo = getRepository();
  const views = await repo.listCatalogViewsVisibleTo(actor.userId);
  const visibleIds = new Set(views.map((v) => v.id));
  const resolvable = (id: string | null): string | null => (id !== null && (isBuiltinCatalogViewId(id) || visibleIds.has(id)) ? id : null);
  return {
    views: await toDtos(actor, views),
    builtins: BUILTIN_CATALOG_VIEWS,
    defaults: {
      personal: resolvable(await repo.getCatalogViewDefault(personalScope(actor.userId))),
      team: resolvable(await repo.getCatalogViewDefault("team")),
    },
  };
}

export interface CreateCatalogViewInput {
  name: unknown;
  isShared?: unknown;
  config: unknown;
}

export async function createCatalogView(actor: CatalogViewActor, input: CreateCatalogViewInput): Promise<CatalogViewDto> {
  const name = cleanName(input.name);
  const config = requireConfig(input.config);
  await assertNameAvailable(actor.userId, name);
  const created = await getRepository().insertCatalogView({
    name,
    ownerUserId: actor.userId,
    isShared: input.isShared === true,
    config,
  });
  return (await toDtos(actor, [created]))[0]!;
}

export interface UpdateCatalogViewInput {
  name?: unknown;
  isShared?: unknown;
  config?: unknown;
}

export async function updateCatalogView(actor: CatalogViewActor, id: string, input: UpdateCatalogViewInput): Promise<CatalogViewDto> {
  const existing = await loadOwnedOrThrow(actor, id);
  const patch: { name?: string; isShared?: boolean; config?: CatalogViewConfig } = {};
  if (input.name !== undefined) {
    patch.name = cleanName(input.name);
    await assertNameAvailable(existing.ownerUserId, patch.name, id);
  }
  if (input.isShared !== undefined) patch.isShared = input.isShared === true;
  if (input.config !== undefined) patch.config = requireConfig(input.config);
  const updated = await getRepository().updateCatalogView(id, patch);
  // Unsharing a view the team default points at would leave everyone else with a default they can't open.
  if (patch.isShared === false && (await getRepository().getCatalogViewDefault("team")) === id) {
    await getRepository().setCatalogViewDefault("team", null);
  }
  return (await toDtos(actor, [updated]))[0]!;
}

export async function deleteCatalogView(actor: CatalogViewActor, id: string): Promise<void> {
  await loadOwnedOrThrow(actor, id);
  await getRepository().deleteCatalogView(id);
}

/**
 * scope "personal" is anyone's own default; "team" is what opens for people
 * who haven't picked one, and only an admin may set it. A default must be a
 * built-in view or one the person can actually see (their own, or shared),
 * so nobody can point the team at someone else's private view.
 */
export async function setCatalogViewDefault(actor: CatalogViewActor, scope: unknown, viewId: unknown): Promise<void> {
  if (scope !== "personal" && scope !== "team") {
    throw new ValidationError("INVALID_DEFAULT_SCOPE", 'scope must be "personal" or "team".');
  }
  if (scope === "team" && actor.role !== "admin") {
    throw new ForbiddenError("Only an admin can set the team default view.");
  }
  const repo = getRepository();
  const storageScope = scope === "team" ? "team" : personalScope(actor.userId);
  if (viewId === null) {
    await repo.setCatalogViewDefault(storageScope, null);
    return;
  }
  if (typeof viewId !== "string" || viewId === "") {
    throw new ValidationError("INVALID_VIEW_ID", "viewId must be a view id, or null to clear the default.");
  }
  if (!isBuiltinCatalogViewId(viewId)) {
    const view = await repo.findCatalogViewById(viewId);
    const usable = view && (view.isShared || view.ownerUserId === actor.userId);
    if (!usable) throw new NotFoundError("That view was not found.");
    // A team default has to be something the whole team can open.
    if (scope === "team" && !view.isShared) {
      throw new ValidationError("VIEW_NOT_SHARED", "Share the view with the team before making it the team default.");
    }
  }
  await repo.setCatalogViewDefault(storageScope, viewId);
}
