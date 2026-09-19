import { describe, it, expect } from "vitest";
import { buildCustomFieldValuesPayload, MIVA_CUSTOM_FIELD_MAP } from "./mivaFieldMap";

describe("buildCustomFieldValuesPayload", () => {
  it("includes all six managed fields, not just five", () => {
    const payload = buildCustomFieldValuesPayload({
      simpleInventory: "IN STOCK",
      availability: "in stock",
      restockMessage: "restock note",
      dataFeed: "Yes",
      shoppingFeed: "",
      reportFlag: "1",
    });
    const customfields = payload["customfields"]!;
    expect(customfields[MIVA_CUSTOM_FIELD_MAP.simpleInventory.fieldCode]).toBe("IN STOCK");
    expect(customfields[MIVA_CUSTOM_FIELD_MAP.availability.fieldCode]).toBe("in stock");
    expect(customfields[MIVA_CUSTOM_FIELD_MAP.restockMessage.fieldCode]).toBe("restock note");
    expect(customfields[MIVA_CUSTOM_FIELD_MAP.dataFeed.fieldCode]).toBe("Yes");
    expect(customfields[MIVA_CUSTOM_FIELD_MAP.shoppingFeed.fieldCode]).toBe("");
    expect(customfields[MIVA_CUSTOM_FIELD_MAP.reportFlag.fieldCode]).toBe("1");
  });

  it("omits fields that aren't provided", () => {
    const payload = buildCustomFieldValuesPayload({ simpleInventory: "SOLD OUT" });
    const customfields = payload["customfields"]!;
    expect(Object.keys(customfields)).toEqual([MIVA_CUSTOM_FIELD_MAP.simpleInventory.fieldCode]);
  });
});
