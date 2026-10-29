import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseDiscontinuedListWorkbook } from "./discontinuedListParser";
import { parseOlliixWorkbook } from "./olliixParser";
import { parseGobiWorkbook } from "./gobiParser";

// The real notification Alex emailed on 2026-10-23, plus the real daily feed it must never be confused with.
const VENDORS = path.resolve(__dirname, "../../../../../Vendors");
const LIST_FILE = path.join(VENDORS, "Discontinue_Items_Notification_Email_202610231500007732.xlsx");
const FEED_FILE = path.join(VENDORS, "Dealer_Inventory_202610230801063499.xlsx");

describe("parseDiscontinuedListWorkbook", () => {
  it("parses the real notification: 36 items, nothing skipped", async () => {
    if (!existsSync(LIST_FILE)) throw new Error(`Sample file not found at ${LIST_FILE}`);
    const { items, skippedRows } = await parseDiscontinuedListWorkbook(readFileSync(LIST_FILE));
    expect(items).toHaveLength(36);
    expect(skippedRows).toHaveLength(0);
  });

  it("keeps UPC leading zeros, the item number, and converts the Excel serial date", async () => {
    const { items } = await parseDiscontinuedListWorkbook(readFileSync(LIST_FILE));
    const first = items.find((i) => i.itemNo === "SI55-0062")!;
    expect(first.normalizedUpc).toBe("022164437034");
    expect(first.description).toBe("Heated Mattress Pad");
    expect(first.division).toBe("Blanket");
    expect(first.category).toBe("ELEC MATT PAD");
    expect(first.discontinuedDate).toBe("2026-10-21");
    expect(items.find((i) => i.itemNo === "BR54-0308")!.discontinuedDate).toBe("2026-10-16");
  });

  it("rejects the daily Olliix feed and the Gobi report, and they reject it", async () => {
    await expect(parseDiscontinuedListWorkbook(readFileSync(FEED_FILE))).rejects.toMatchObject({ code: "SHEET_NOT_FOUND" });
    await expect(parseOlliixWorkbook(readFileSync(LIST_FILE))).rejects.toThrow();
    await expect(parseGobiWorkbook(readFileSync(LIST_FILE))).rejects.toThrow();
  });
});
