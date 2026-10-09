"use strict";

// Occunomix daily inventory plugin parser.
//
// Despite the ".csv" extension, this vendor's export is actually:
//   - UTF-16LE encoded, with a byte-order-mark (FF FE) at the start
//   - tab-delimited, not comma-delimited
//   - followed by a non-data "underline" row right after the header
//     (e.g. "-----\t----------\t...") left over from the spreadsheet export
//   - salted with a placeholder catalog row (STYLE "Dummy" / ITEMNUMBER
//     "NOPRODUCT") and a trailing legal-disclaimer row with a blank STYLE
//     and free text in place of an item number
// None of that fits the generic column-mapping ("simple_csv") parser, which
// assumes UTF-8, comma-delimited, single-header-row files with no row
// filtering -- hence this plugin.

const REQUIRED_HEADERS = ["STYLE", "ITEMNUMBER", "PRODUCTNAME", "AVAILABLE ONHAND"];

const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);

function decodeText(buffer) {
  if (buffer.length >= 2 && buffer.subarray(0, 2).equals(UTF16LE_BOM)) {
    return buffer.toString("utf16le").replace(/^﻿/, "");
  }
  return buffer.toString("utf8").replace(/^﻿/, "");
}

/** Non-breaking spaces show up inside at least one STYLE value in this feed. */
function cleanCell(value) {
  return (value ?? "").replace(/ /g, " ").trim();
}

function isDashesRow(fields) {
  return fields.every((f) => f.trim() === "" || /^-+$/.test(f.trim()));
}

/**
 * Parses the Occunomix daily inventory export.
 * @param {Buffer} buffer
 * @returns {Promise<{ rows: Array<{sourceRowNumber:number,itemNoRaw:string|null,upcRaw:string|null,skuRaw:string|null,descriptionRaw:string|null,totalQtyRaw:string|null}> }>}
 */
async function parse(buffer) {
  const text = decodeText(buffer);
  const lines = text.split(/\r\n|\r|\n/);

  const headerLineIndex = lines.findIndex((l) => l.trim() !== "");
  if (headerLineIndex === -1) {
    throw new Error("The Occunomix file contains zero usable data rows.");
  }
  const header = lines[headerLineIndex].split("\t").map((h) => h.trim());

  const missing = REQUIRED_HEADERS.filter((h) => !header.includes(h));
  if (missing.length > 0) {
    throw new Error(`The Occunomix file is missing required columns: ${missing.join(", ")}.`);
  }

  const styleIndex = header.indexOf("STYLE");
  const itemNumberIndex = header.indexOf("ITEMNUMBER");
  const productNameIndex = header.indexOf("PRODUCTNAME");
  const qtyIndex = header.indexOf("AVAILABLE ONHAND");

  const rows = [];
  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    const fields = line.split("\t");
    if (isDashesRow(fields)) continue;

    const style = cleanCell(fields[styleIndex]);
    const itemNo = cleanCell(fields[itemNumberIndex]);
    const description = cleanCell(fields[productNameIndex]);
    const qty = cleanCell(fields[qtyIndex]);

    // Blank STYLE covers both the trailing "zzz*..." disclaimer row and any
    // other non-product row; "Dummy"/"NOPRODUCT" is the known placeholder
    // catalog entry (qty 0, not real inventory).
    if (style === "") continue;
    if (style === "Dummy" && itemNo === "NOPRODUCT") continue;

    rows.push({
      sourceRowNumber: i + 1,
      itemNoRaw: itemNo || null,
      upcRaw: null,
      skuRaw: itemNo || null,
      descriptionRaw: description || null,
      totalQtyRaw: qty || null,
    });
  }

  if (rows.length === 0) {
    throw new Error("The Occunomix file contains zero usable data rows.");
  }

  return { rows };
}

module.exports = { parse };
