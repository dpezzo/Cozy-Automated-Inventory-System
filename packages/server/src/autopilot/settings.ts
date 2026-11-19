import { getRepository } from "../db";
import { ValidationError } from "../errors";
import { DEFAULT_BRAKE_LIMITS, type BrakeLimits } from "./brake";
import { parseSenderList } from "./senders";

/** "off" does nothing; "review" reads the mailbox and reports what it would have done (Stage 1 pushes nothing). */
export type AutopilotMode = "off" | "review";

const MODE_KEY = "autopilot_mode";
const HOLD_MINUTES_KEY = "autopilot_hold_minutes";
const BRAKE_KEY = "autopilot_brake_limits";
const ENABLED_SINCE_KEY = "autopilot_enabled_since";
const vendorEnabledKey = (vendorKey: string) => `autopilot_vendor_enabled:${vendorKey}`;
const vendorSendersKey = (vendorKey: string) => `autopilot_vendor_senders:${vendorKey}`;

export const DEFAULT_HOLD_MINUTES = 10;
/** Used for any vendor that has never had its own list saved (Darren, 2026-11-18). */
export const DEFAULT_APPROVED_SENDERS = "cale@delutti.com, dpezzo@gmail.com";

export async function getAutopilotMode(): Promise<AutopilotMode> {
  return (await getRepository().getAppSetting(MODE_KEY)) === "review" ? "review" : "off";
}

/** The moment autopilot was first switched on; mail older than this is never touched. Null until then. */
export async function getEnabledSince(): Promise<string | null> {
  return getRepository().getAppSetting(ENABLED_SINCE_KEY);
}

export async function setAutopilotMode(mode: unknown): Promise<AutopilotMode> {
  if (mode !== "off" && mode !== "review") {
    throw new ValidationError("INVALID_AUTOPILOT_SETTINGS", 'mode must be "off" or "review".');
  }
  const repo = getRepository();
  await repo.setAppSetting(MODE_KEY, mode);
  if (mode !== "off" && (await repo.getAppSetting(ENABLED_SINCE_KEY)) === null) {
    await repo.setAppSetting(ENABLED_SINCE_KEY, new Date().toISOString());
  }
  return mode;
}

/** How long a held run waits before a later stage may push it. Read fresh every poll, so a change needs no redeploy. Unused by Stage 1 (it never pushes) but stored now so the setting already exists. */
export async function getHoldMinutes(): Promise<number> {
  const raw = await getRepository().getAppSetting(HOLD_MINUTES_KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_HOLD_MINUTES;
}

export async function setHoldMinutes(minutes: unknown): Promise<number> {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
    throw new ValidationError("INVALID_AUTOPILOT_SETTINGS", "Hold minutes must be a number between 1 and 1440.");
  }
  const whole = Math.round(minutes);
  await getRepository().setAppSetting(HOLD_MINUTES_KEY, String(whole));
  return whole;
}

function parseBrakeLimits(value: unknown): BrakeLimits {
  const v = (value ?? {}) as Record<string, unknown>;
  const num = (key: keyof BrakeLimits, min: number, max: number): number => {
    const n = v[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) {
      throw new ValidationError("INVALID_AUTOPILOT_SETTINGS", `${key} must be a number between ${min} and ${max}.`);
    }
    return n;
  };
  return {
    minRowRatio: num("minRowRatio", 0, 1),
    maxChangedPercent: num("maxChangedPercent", 0, 100),
    maxNlaProposals: num("maxNlaProposals", 0, 100000),
    maxMissingOrBlockedPercent: num("maxMissingOrBlockedPercent", 0, 100),
  };
}

export async function getBrakeLimits(): Promise<BrakeLimits> {
  const raw = await getRepository().getAppSetting(BRAKE_KEY);
  if (!raw) return DEFAULT_BRAKE_LIMITS;
  try {
    return parseBrakeLimits(JSON.parse(raw));
  } catch {
    return DEFAULT_BRAKE_LIMITS;
  }
}

export async function setBrakeLimits(value: unknown): Promise<BrakeLimits> {
  const limits = parseBrakeLimits(value);
  await getRepository().setAppSetting(BRAKE_KEY, JSON.stringify(limits));
  return limits;
}

export async function isVendorAutopilotEnabled(vendorKey: string): Promise<boolean> {
  return (await getRepository().getAppSetting(vendorEnabledKey(vendorKey))) === "true";
}

export async function getVendorApprovedSenders(vendorKey: string): Promise<string[]> {
  const raw = await getRepository().getAppSetting(vendorSendersKey(vendorKey));
  return parseSenderList(raw ?? DEFAULT_APPROVED_SENDERS);
}

export interface VendorAutopilotSetting {
  vendorKey: string;
  vendorLabel: string;
  enabled: boolean;
  approvedSenders: string[];
}

export async function listVendorAutopilotSettings(): Promise<VendorAutopilotSetting[]> {
  const configs = await getRepository().listVendorConfigs();
  const result: VendorAutopilotSetting[] = [];
  for (const c of configs) {
    if (!c.isActive) continue;
    result.push({
      vendorKey: c.vendorKey,
      vendorLabel: c.vendorLabel,
      enabled: await isVendorAutopilotEnabled(c.vendorKey),
      approvedSenders: await getVendorApprovedSenders(c.vendorKey),
    });
  }
  return result;
}

export async function setVendorAutopilot(vendorKey: string, patch: { enabled?: unknown; approvedSenders?: unknown }): Promise<void> {
  const repo = getRepository();
  const config = await repo.findVendorConfigByKey(vendorKey);
  if (!config || !config.isActive) throw new ValidationError("VENDOR_NOT_FOUND", `Vendor "${vendorKey}" was not found.`);
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== "boolean") throw new ValidationError("INVALID_AUTOPILOT_SETTINGS", "enabled must be true or false.");
    await repo.setAppSetting(vendorEnabledKey(vendorKey), String(patch.enabled));
  }
  if (patch.approvedSenders !== undefined) {
    if (typeof patch.approvedSenders !== "string") {
      throw new ValidationError("INVALID_AUTOPILOT_SETTINGS", "approvedSenders must be a comma-separated list of email addresses.");
    }
    const list = parseSenderList(patch.approvedSenders);
    const bad = list.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (bad) throw new ValidationError("INVALID_AUTOPILOT_SETTINGS", `"${bad}" is not a valid email address.`);
    await repo.setAppSetting(vendorSendersKey(vendorKey), list.join(", "));
  }
}

/** Every address approved for any autopilot-enabled vendor: the first, cheap gate before a message is opened any further. */
export async function getAllEnabledSenders(): Promise<string[]> {
  const all = new Set<string>();
  for (const v of await listVendorAutopilotSettings()) {
    if (v.enabled) v.approvedSenders.forEach((s) => all.add(s));
  }
  return [...all];
}
