import { getRepository } from "../db";
import { ForbiddenError, ValidationError } from "../errors";

/**
 * App-wide on/off switches an admin controls from Settings > Features. A new
 * feature that isn't ready for everyone ships behind one of these, off by
 * default, so deploying it changes nothing until someone turns it on.
 */
export const FEATURE_FLAGS = {
  catalogViews: {
    settingKey: "feature_catalog_views",
    defaultEnabled: false,
    turnedOffMessage: "Saved Catalog views are turned off. An admin can turn them on in Settings > Features.",
  },
} as const;

export type FeatureName = keyof typeof FEATURE_FLAGS;
export type FeatureFlags = Record<FeatureName, boolean>;

const FEATURE_NAMES = Object.keys(FEATURE_FLAGS) as FeatureName[];

export async function isFeatureEnabled(name: FeatureName): Promise<boolean> {
  const def = FEATURE_FLAGS[name];
  const stored = await getRepository().getAppSetting(def.settingKey);
  if (stored === null) return def.defaultEnabled;
  return stored === "true";
}

export async function getFeatureFlags(): Promise<FeatureFlags> {
  const flags = {} as FeatureFlags;
  for (const name of FEATURE_NAMES) flags[name] = await isFeatureEnabled(name);
  return flags;
}

/** Throws if the feature is off, so a route can refuse the request instead of quietly serving a hidden feature. */
export async function assertFeatureEnabled(name: FeatureName): Promise<void> {
  if (!(await isFeatureEnabled(name))) throw new ForbiddenError(FEATURE_FLAGS[name].turnedOffMessage);
}

/** Applies only the switches present in `patch`; anything unknown or not a boolean is rejected, never ignored. */
export async function setFeatureFlags(patch: unknown): Promise<{ changed: Partial<FeatureFlags>; flags: FeatureFlags }> {
  if (typeof patch !== "object" || patch === null) {
    throw new ValidationError("INVALID_FEATURES", "Send an object such as { catalogViews: true }.");
  }
  const changed: Partial<FeatureFlags> = {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!FEATURE_NAMES.includes(key as FeatureName)) {
      throw new ValidationError("INVALID_FEATURES", `"${key}" is not a known feature.`);
    }
    if (typeof value !== "boolean") {
      throw new ValidationError("INVALID_FEATURES", `"${key}" must be true or false.`);
    }
    const name = key as FeatureName;
    await getRepository().setAppSetting(FEATURE_FLAGS[name].settingKey, String(value));
    changed[name] = value;
  }
  return { changed, flags: await getFeatureFlags() };
}
