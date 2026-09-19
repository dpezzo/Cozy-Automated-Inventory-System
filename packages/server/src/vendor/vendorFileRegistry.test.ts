import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { detectVendorFile } from "./vendorFileRegistry";

const VENDORS_DIR = path.resolve(__dirname, "../../../../../Vendors");

describe("detectVendorFile", () => {
  it("detects the real Olliix file as olliix_workbook", async () => {
    const buffer = readFileSync(path.join(VENDORS_DIR, "Olliix_daily_inventory.xlsx"));
    const result = await detectVendorFile(buffer);
    expect(result.vendorKey).toBe("olliix");
    expect(result.fileKind).toBe("olliix_workbook");
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("detects the real K&H file as kh_workbook", async () => {
    const buffer = readFileSync(path.join(VENDORS_DIR, "KandHPet_daily_inventory.csv"));
    const result = await detectVendorFile(buffer);
    expect(result.vendorKey).toBe("kh");
    expect(result.fileKind).toBe("kh_workbook");
    expect(result.rows).toHaveLength(249);
  });

  it("detects the real Gobi file as gobi_workbook", async () => {
    const buffer = readFileSync(path.join(VENDORS_DIR, "Gobi_daily_inventory.xlsx"));
    const result = await detectVendorFile(buffer);
    expect(result.vendorKey).toBe("gobi");
    expect(result.fileKind).toBe("gobi_workbook");
    expect(result.rows).toHaveLength(687);
  });

  it("detects the real FieldSheer/MobileWarming file as fieldsheer_workbook", async () => {
    const buffer = readFileSync(path.join(VENDORS_DIR, "FieldSheer-MobileWarming_daily_inventory.csv"));
    const result = await detectVendorFile(buffer);
    expect(result.vendorKey).toBe("fieldsheer");
    expect(result.fileKind).toBe("fieldsheer_workbook");
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("throws VENDOR_NOT_DETECTED for a file matching no known vendor format", async () => {
    const buffer = Buffer.from("this,is,not,a,vendor,file\n1,2,3,4,5,6", "utf8");
    await expect(detectVendorFile(buffer)).rejects.toMatchObject({ code: "VENDOR_NOT_DETECTED" });
  });
});
