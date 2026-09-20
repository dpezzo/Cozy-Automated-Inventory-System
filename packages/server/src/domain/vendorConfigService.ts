import { getRepository, type VendorConfigRecord, type VendorFileShape, type VendorMatchStrategy } from "../db";
import type { GenericCsvColumnMapping } from "../vendor/genericCsvParser";
import { listAvailablePluginFiles as listPluginFilesOnDisk, reloadPlugins as reloadPluginsOnDisk } from "../vendor/pluginLoader";
import { ValidationError } from "../errors";

const VENDOR_KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VALID_MATCH_STRATEGIES: VendorMatchStrategy[] = ["upc-to-gtin", "sku-to-mpn"];

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new ValidationError("INVALID_TIMEZONE", `"${timezone}" is not a valid IANA timezone.`);
  }
}

function assertCommonFields(input: {
  vendorLabel: string;
  inStockThreshold: number;
  timezone: string;
  brandAllowlist: string[];
  matchStrategy: string;
}): void {
  if (!input.vendorLabel || !input.vendorLabel.trim()) {
    throw new ValidationError("INVALID_VENDOR_LABEL", "vendorLabel is required.");
  }
  if (!Number.isFinite(input.inStockThreshold) || input.inStockThreshold <= 0) {
    throw new ValidationError("INVALID_THRESHOLD", "inStockThreshold must be a positive number.");
  }
  if (!Array.isArray(input.brandAllowlist) || input.brandAllowlist.length === 0) {
    throw new ValidationError("INVALID_BRAND_ALLOWLIST", "brandAllowlist must contain at least one brand.");
  }
  if (!VALID_MATCH_STRATEGIES.includes(input.matchStrategy as VendorMatchStrategy)) {
    throw new ValidationError("INVALID_MATCH_STRATEGY", `matchStrategy must be one of: ${VALID_MATCH_STRATEGIES.join(", ")}.`);
  }
  assertValidTimezone(input.timezone);
}

function assertValidColumnMapping(mapping: GenericCsvColumnMapping | undefined): asserts mapping is GenericCsvColumnMapping {
  if (
    !mapping ||
    !mapping.identifierColumn?.trim() ||
    !mapping.quantityColumn?.trim() ||
    (mapping.identifierType !== "upc" && mapping.identifierType !== "sku")
  ) {
    throw new ValidationError(
      "INVALID_COLUMN_MAPPING",
      "columnMapping requires identifierColumn, quantityColumn, and identifierType ('upc' or 'sku').",
    );
  }
}

export async function listVendorConfigs(): Promise<VendorConfigRecord[]> {
  return getRepository().listVendorConfigs();
}

export interface VendorConfigSummary {
  vendorKey: string;
  vendorLabel: string;
  fileShape: VendorFileShape;
  isActive: boolean;
}

/**
 * Minimal, non-sensitive vendor info any signed-in user (not just admins)
 * can see -- enough for the Home page to label a vendor file and build its
 * upload/selection UI, without exposing tunables (threshold, brand
 * allowlist, match strategy) that only affect reconciliation correctness and
 * are gated admin-only via the full listVendorConfigs()/GET /vendors.
 */
export async function listVendorConfigSummaries(): Promise<VendorConfigSummary[]> {
  const configs = await getRepository().listVendorConfigs();
  return configs
    .filter((c) => c.isActive)
    .map((c) => ({ vendorKey: c.vendorKey, vendorLabel: c.vendorLabel, fileShape: c.fileShape, isActive: c.isActive }));
}

export interface CreateSimpleCsvVendorRequest {
  vendorKey: string;
  vendorLabel: string;
  inStockThreshold: number;
  timezone: string;
  brandAllowlist: string[];
  matchStrategy: VendorMatchStrategy;
  fileShape: "simple_csv";
  columnMapping: GenericCsvColumnMapping;
}

export interface CreatePluginVendorRequest {
  vendorKey: string;
  vendorLabel: string;
  inStockThreshold: number;
  timezone: string;
  brandAllowlist: string[];
  matchStrategy: VendorMatchStrategy;
  fileShape: "plugin";
  pluginFilename: string;
}

export type CreateVendorConfigRequest = CreateSimpleCsvVendorRequest | CreatePluginVendorRequest;

/**
 * Creating a 'custom'-shape vendor is deliberately not exposed here (or via
 * any route) -- that shape always means a developer has already written a
 * parser file directly into src/vendor/ and wired it into
 * vendorFileRegistry.ts, which this service has no part in.
 */
export async function createVendorConfig(input: CreateVendorConfigRequest, actorId: string): Promise<VendorConfigRecord> {
  if (!VENDOR_KEY_RE.test(input.vendorKey)) {
    throw new ValidationError("INVALID_VENDOR_KEY", "vendorKey must be lowercase alphanumeric with hyphens, e.g. 'my-vendor'.");
  }
  assertCommonFields(input);

  const repo = getRepository();
  const existing = await repo.findVendorConfigByKey(input.vendorKey);
  if (existing) {
    throw new ValidationError("VENDOR_KEY_IN_USE", `A vendor with key "${input.vendorKey}" already exists.`);
  }

  let record: VendorConfigRecord;
  if (input.fileShape === "simple_csv") {
    assertValidColumnMapping(input.columnMapping);
    record = await repo.insertVendorConfig({
      vendorKey: input.vendorKey,
      vendorLabel: input.vendorLabel,
      inStockThreshold: input.inStockThreshold,
      timezone: input.timezone,
      brandAllowlist: input.brandAllowlist,
      matchStrategy: input.matchStrategy,
      fileShape: "simple_csv",
      columnMapping: input.columnMapping,
    });
  } else {
    if (!input.pluginFilename) {
      throw new ValidationError("INVALID_PLUGIN_FILENAME", "pluginFilename is required for file_shape 'plugin'.");
    }
    const alreadyRegistered = new Set(
      (await repo.listVendorConfigs()).map((c) => c.pluginFilename).filter((f): f is string => !!f),
    );
    const available = listPluginFilesOnDisk(alreadyRegistered);
    if (!available.includes(input.pluginFilename)) {
      throw new ValidationError(
        "PLUGIN_FILE_NOT_AVAILABLE",
        `"${input.pluginFilename}" is not an available (unregistered) plugin file on the server.`,
      );
    }
    record = await repo.insertVendorConfig({
      vendorKey: input.vendorKey,
      vendorLabel: input.vendorLabel,
      inStockThreshold: input.inStockThreshold,
      timezone: input.timezone,
      brandAllowlist: input.brandAllowlist,
      matchStrategy: input.matchStrategy,
      fileShape: "plugin",
      pluginFilename: input.pluginFilename,
    });
  }

  await repo.insertAuditLog({
    actorId,
    action: "VENDOR_CONFIG_CREATED",
    entityType: "vendor_config",
    entityId: record.vendorKey,
    details: { vendorLabel: record.vendorLabel, fileShape: record.fileShape },
  });
  return record;
}

export interface UpdateVendorConfigRequest {
  vendorLabel?: string;
  inStockThreshold?: number;
  timezone?: string;
  brandAllowlist?: string[];
  matchStrategy?: VendorMatchStrategy;
  columnMapping?: GenericCsvColumnMapping;
}

/** vendor_key is immutable and never accepted in a patch -- it's the primary key and ruleId-derivation source. */
export async function updateVendorConfig(
  vendorKey: string,
  patch: UpdateVendorConfigRequest,
  actorId: string,
): Promise<VendorConfigRecord> {
  const repo = getRepository();
  const existing = await repo.findVendorConfigByKey(vendorKey);
  if (!existing) {
    throw new ValidationError("VENDOR_NOT_FOUND", `No vendor configuration found for "${vendorKey}".`);
  }

  assertCommonFields({
    vendorLabel: patch.vendorLabel ?? existing.vendorLabel,
    inStockThreshold: patch.inStockThreshold ?? existing.inStockThreshold,
    timezone: patch.timezone ?? existing.timezone,
    brandAllowlist: patch.brandAllowlist ?? existing.brandAllowlist,
    matchStrategy: patch.matchStrategy ?? existing.matchStrategy,
  });
  if (patch.columnMapping !== undefined) {
    if (existing.fileShape !== "simple_csv") {
      throw new ValidationError("COLUMN_MAPPING_NOT_APPLICABLE", "columnMapping only applies to 'simple_csv' vendors.");
    }
    assertValidColumnMapping(patch.columnMapping);
  }

  const record = await repo.updateVendorConfig(vendorKey, patch);
  await repo.insertAuditLog({
    actorId,
    action: "VENDOR_CONFIG_UPDATED",
    entityType: "vendor_config",
    entityId: vendorKey,
    details: { ...patch },
  });
  return record;
}

export async function deactivateVendorConfig(vendorKey: string, actorId: string): Promise<void> {
  const repo = getRepository();
  const existing = await repo.findVendorConfigByKey(vendorKey);
  if (!existing) {
    throw new ValidationError("VENDOR_NOT_FOUND", `No vendor configuration found for "${vendorKey}".`);
  }
  await repo.deactivateVendorConfig(vendorKey);
  await repo.insertAuditLog({
    actorId,
    action: "VENDOR_CONFIG_DEACTIVATED",
    entityType: "vendor_config",
    entityId: vendorKey,
  });
}

export async function listAvailablePluginFiles(): Promise<string[]> {
  const repo = getRepository();
  const alreadyRegistered = new Set(
    (await repo.listVendorConfigs()).map((c) => c.pluginFilename).filter((f): f is string => !!f),
  );
  return listPluginFilesOnDisk(alreadyRegistered);
}

export function reloadPlugins(): void {
  reloadPluginsOnDisk();
}

export type { VendorFileShape };
