import { describe, it, expect } from "vitest";
import { parseKhWorkbook } from "./khParser";

function csvWithBom(rows: string[]): Buffer {
  const header = '"﻿Item ID",UPC,QOH,Cost,MAP,Brand,Weight,Length,Width,Height,Item Name';
  return Buffer.from([header, ...rows].join("\n"), "utf8");
}

describe("parseKhWorkbook", () => {
  it("strips the BOM embedded inside the quoted first header and reads Item ID correctly", () => {
    const buffer = csvWithBom(['KH1,000111111111,5,10,,"K&H Pet Products",1,1,1,1,"K&H Bed"']);
    const { rows } = parseKhWorkbook(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.itemNoRaw).toBe("KH1");
    expect(rows[0]!.upcRaw).toBe("000111111111");
    expect(rows[0]!.totalQtyRaw).toBe("5");
  });

  it("filters out every row not for Brand = K&H Pet Products, from a shared multi-vendor distributor feed", () => {
    const buffer = csvWithBom([
      'KH1,000111111111,5,10,,"K&H Pet Products",1,1,1,1,"K&H Bed"',
      'OTHER1,000222222222,9,10,,"Some Other Brand",1,1,1,1,"Other Item"',
      'KH2,000333333333,2,10,,"K&H Pet Products",1,1,1,1,"K&H Toy"',
    ]);
    const { rows } = parseKhWorkbook(buffer);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.itemNoRaw)).toEqual(["KH1", "KH2"]);
  });

  it("preserves original row numbering across filtered-out rows, for traceability", () => {
    const buffer = csvWithBom([
      'OTHER1,000222222222,9,10,,"Some Other Brand",1,1,1,1,"Other Item"',
      'KH2,000333333333,2,10,,"K&H Pet Products",1,1,1,1,"K&H Toy"',
    ]);
    const { rows } = parseKhWorkbook(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceRowNumber).toBe(2);
  });
});
