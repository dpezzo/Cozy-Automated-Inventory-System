import { describe, it, expect, vi, beforeEach } from "vitest";

const listVendorConfigs = vi.fn();
const findVendorConfigByKey = vi.fn();
const insertVendorConfig = vi.fn();
const updateVendorConfigMock = vi.fn();
const deactivateVendorConfigMock = vi.fn();
const insertAuditLog = vi.fn();

vi.mock("../db", () => ({
  getRepository: () => ({
    listVendorConfigs,
    findVendorConfigByKey,
    insertVendorConfig,
    updateVendorConfig: updateVendorConfigMock,
    deactivateVendorConfig: deactivateVendorConfigMock,
    insertAuditLog,
  }),
}));

const listAvailablePluginFiles = vi.fn();
const reloadPluginsOnDisk = vi.fn();
vi.mock("../vendor/pluginLoader", () => ({
  listAvailablePluginFiles: (...args: unknown[]) => listAvailablePluginFiles(...args),
  reloadPlugins: (...args: unknown[]) => reloadPluginsOnDisk(...args),
}));

function baseSimpleCsvRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    vendorKey: "acme",
    vendorLabel: "Acme Co",
    inStockThreshold: 5,
    timezone: "America/New_York",
    brandAllowlist: ["Acme"],
    matchStrategy: "upc-to-gtin" as const,
    fileShape: "simple_csv" as const,
    columnMapping: { identifierColumn: "UPC", identifierType: "upc" as const, quantityColumn: "Qty" },
    ...overrides,
  };
}

function existingRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    vendorKey: "acme",
    vendorLabel: "Acme Co",
    inStockThreshold: 5,
    timezone: "America/New_York",
    brandAllowlist: ["Acme"],
    matchStrategy: "upc-to-gtin",
    missingBlockerCode: null,
    fileShape: "simple_csv",
    columnMapping: { identifierColumn: "UPC", identifierType: "upc", quantityColumn: "Qty" },
    pluginFilename: null,
    isActive: true,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("vendorConfigService", () => {
  beforeEach(() => {
    listVendorConfigs.mockReset();
    findVendorConfigByKey.mockReset();
    insertVendorConfig.mockReset();
    updateVendorConfigMock.mockReset();
    deactivateVendorConfigMock.mockReset();
    insertAuditLog.mockReset();
    listAvailablePluginFiles.mockReset();
    reloadPluginsOnDisk.mockReset();
    listVendorConfigs.mockResolvedValue([]);
  });

  describe("createVendorConfig", () => {
    it("rejects an invalid vendor key", async () => {
      const { createVendorConfig } = await import("./vendorConfigService");
      await expect(createVendorConfig(baseSimpleCsvRequest({ vendorKey: "Not Valid!" }), "actor-1")).rejects.toMatchObject({
        code: "INVALID_VENDOR_KEY",
      });
      expect(insertVendorConfig).not.toHaveBeenCalled();
    });

    it("rejects an empty brand allowlist", async () => {
      const { createVendorConfig } = await import("./vendorConfigService");
      await expect(createVendorConfig(baseSimpleCsvRequest({ brandAllowlist: [] }), "actor-1")).rejects.toMatchObject({
        code: "INVALID_BRAND_ALLOWLIST",
      });
    });

    it("rejects a non-positive threshold", async () => {
      const { createVendorConfig } = await import("./vendorConfigService");
      await expect(createVendorConfig(baseSimpleCsvRequest({ inStockThreshold: 0 }), "actor-1")).rejects.toMatchObject({
        code: "INVALID_THRESHOLD",
      });
    });

    it("rejects an invalid IANA timezone", async () => {
      const { createVendorConfig } = await import("./vendorConfigService");
      await expect(createVendorConfig(baseSimpleCsvRequest({ timezone: "Not/AZone" }), "actor-1")).rejects.toMatchObject({
        code: "INVALID_TIMEZONE",
      });
    });

    it("rejects a duplicate vendor key", async () => {
      findVendorConfigByKey.mockResolvedValue(existingRecord());
      const { createVendorConfig } = await import("./vendorConfigService");
      await expect(createVendorConfig(baseSimpleCsvRequest(), "actor-1")).rejects.toMatchObject({ code: "VENDOR_KEY_IN_USE" });
      expect(insertVendorConfig).not.toHaveBeenCalled();
    });

    it("rejects an incomplete column mapping for a simple_csv vendor", async () => {
      findVendorConfigByKey.mockResolvedValue(null);
      const { createVendorConfig } = await import("./vendorConfigService");
      await expect(
        createVendorConfig(baseSimpleCsvRequest({ columnMapping: { identifierColumn: "", identifierType: "upc", quantityColumn: "Qty" } }), "actor-1"),
      ).rejects.toMatchObject({ code: "INVALID_COLUMN_MAPPING" });
    });

    it("creates a simple_csv vendor and logs an audit entry", async () => {
      findVendorConfigByKey.mockResolvedValue(null);
      insertVendorConfig.mockResolvedValue(existingRecord());
      const { createVendorConfig } = await import("./vendorConfigService");
      const record = await createVendorConfig(baseSimpleCsvRequest(), "actor-1");
      expect(record.vendorKey).toBe("acme");
      expect(insertVendorConfig).toHaveBeenCalledWith(expect.objectContaining({ vendorKey: "acme", fileShape: "simple_csv" }));
      expect(insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "VENDOR_CONFIG_CREATED", actorId: "actor-1" }));
    });

    it("rejects registering a plugin file that isn't available on disk", async () => {
      findVendorConfigByKey.mockResolvedValue(null);
      listAvailablePluginFiles.mockReturnValue(["other.js"]);
      const { createVendorConfig } = await import("./vendorConfigService");
      await expect(
        createVendorConfig(
          {
            vendorKey: "acme",
            vendorLabel: "Acme Co",
            inStockThreshold: 5,
            timezone: "America/New_York",
            brandAllowlist: ["Acme"],
            matchStrategy: "upc-to-gtin",
            fileShape: "plugin",
            pluginFilename: "missing.js",
          },
          "actor-1",
        ),
      ).rejects.toMatchObject({ code: "PLUGIN_FILE_NOT_AVAILABLE" });
      expect(insertVendorConfig).not.toHaveBeenCalled();
    });

    it("creates a plugin vendor when the file is available", async () => {
      findVendorConfigByKey.mockResolvedValue(null);
      listAvailablePluginFiles.mockReturnValue(["custom-vendor.js"]);
      insertVendorConfig.mockResolvedValue(existingRecord({ fileShape: "plugin", pluginFilename: "custom-vendor.js", columnMapping: null }));
      const { createVendorConfig } = await import("./vendorConfigService");
      const record = await createVendorConfig(
        {
          vendorKey: "acme",
          vendorLabel: "Acme Co",
          inStockThreshold: 5,
          timezone: "America/New_York",
          brandAllowlist: ["Acme"],
          matchStrategy: "upc-to-gtin",
          fileShape: "plugin",
          pluginFilename: "custom-vendor.js",
        },
        "actor-1",
      );
      expect(record.fileShape).toBe("plugin");
      expect(insertVendorConfig).toHaveBeenCalledWith(expect.objectContaining({ pluginFilename: "custom-vendor.js" }));
    });
  });

  describe("updateVendorConfig", () => {
    it("rejects updating a vendor that does not exist", async () => {
      findVendorConfigByKey.mockResolvedValue(null);
      const { updateVendorConfig } = await import("./vendorConfigService");
      await expect(updateVendorConfig("ghost", { vendorLabel: "X" }, "actor-1")).rejects.toMatchObject({ code: "VENDOR_NOT_FOUND" });
    });

    it("rejects an invalid match strategy", async () => {
      findVendorConfigByKey.mockResolvedValue(existingRecord());
      const { updateVendorConfig } = await import("./vendorConfigService");
      await expect(
        updateVendorConfig("acme", { matchStrategy: "bogus" as never }, "actor-1"),
      ).rejects.toMatchObject({ code: "INVALID_MATCH_STRATEGY" });
    });

    it("rejects columnMapping on a non-simple_csv vendor", async () => {
      findVendorConfigByKey.mockResolvedValue(existingRecord({ fileShape: "custom" }));
      const { updateVendorConfig } = await import("./vendorConfigService");
      await expect(
        updateVendorConfig("acme", { columnMapping: { identifierColumn: "UPC", identifierType: "upc", quantityColumn: "Qty" } }, "actor-1"),
      ).rejects.toMatchObject({ code: "COLUMN_MAPPING_NOT_APPLICABLE" });
    });

    it("updates a vendor and logs an audit entry, never touching vendor_key", async () => {
      findVendorConfigByKey.mockResolvedValue(existingRecord());
      updateVendorConfigMock.mockResolvedValue(existingRecord({ inStockThreshold: 10 }));
      const { updateVendorConfig } = await import("./vendorConfigService");
      const record = await updateVendorConfig("acme", { inStockThreshold: 10 }, "actor-1");
      expect(record.inStockThreshold).toBe(10);
      expect(updateVendorConfigMock).toHaveBeenCalledWith("acme", expect.objectContaining({ inStockThreshold: 10 }));
      expect(insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "VENDOR_CONFIG_UPDATED" }));
    });
  });

  describe("deactivateVendorConfig", () => {
    it("rejects deactivating a vendor that does not exist", async () => {
      findVendorConfigByKey.mockResolvedValue(null);
      const { deactivateVendorConfig } = await import("./vendorConfigService");
      await expect(deactivateVendorConfig("ghost", "actor-1")).rejects.toMatchObject({ code: "VENDOR_NOT_FOUND" });
    });

    it("soft-deletes and logs it", async () => {
      findVendorConfigByKey.mockResolvedValue(existingRecord());
      const { deactivateVendorConfig } = await import("./vendorConfigService");
      await deactivateVendorConfig("acme", "actor-1");
      expect(deactivateVendorConfigMock).toHaveBeenCalledWith("acme");
      expect(insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "VENDOR_CONFIG_DEACTIVATED" }));
    });
  });
});
