import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { ValidationError } from "../errors";

// A small, dependency-light OOXML reader used instead of a full spreadsheet
// library. Some xlsx producers (including the shared bake-off synthetic
// fixture) write workbook/worksheet XML with a custom namespace prefix
// (e.g. <x:workbook>) instead of the default unprefixed namespace that some
// libraries assume. fast-xml-parser's removeNSPrefix option normalizes both
// styles, so this reader works for real Excel exports and minimal writers alike.

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function columnLettersToIndex(letters: string): number {
  let index = 0;
  for (const ch of letters) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index;
}

function splitCellRef(ref: string): { col: number; row: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) throw new ValidationError("FILE_UNREADABLE", `Unrecognized cell reference "${ref}" in worksheet XML.`);
  return { col: columnLettersToIndex(match[1]!), row: Number(match[2]) };
}

function readSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const parsed = parser.parse(xml);
  const items = asArray(parsed?.sst?.si);
  return items.map((si: unknown) => extractSharedStringText(si));
}

function extractSharedStringText(si: unknown): string {
  if (si === null || si === undefined) return "";
  if (typeof si === "string") return si;
  const obj = si as { t?: unknown; r?: unknown | unknown[] };
  if (obj.t !== undefined) return textNodeToString(obj.t);
  if (obj.r !== undefined) {
    return asArray(obj.r as { t?: unknown }[])
      .map((run) => textNodeToString(run?.t))
      .join("");
  }
  return "";
}

function textNodeToString(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (typeof node === "object" && "#text" in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>)["#text"] ?? "");
  }
  return "";
}

export interface WorkbookSheetRef {
  name: string;
  relId: string;
}

interface CellValue {
  col: number;
  text: string | null;
}

export class XlsxDocument {
  private constructor(
    private readonly zip: JSZip,
    private readonly sharedStrings: string[],
    private readonly sheetRefs: WorkbookSheetRef[],
    private readonly relTargets: Map<string, string>,
  ) {}

  static async load(buffer: Buffer): Promise<XlsxDocument> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch (err) {
      throw new ValidationError("FILE_UNREADABLE", "The uploaded file is not a valid .xlsx archive.", err);
    }

    const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
    if (!workbookXml) {
      throw new ValidationError("FILE_UNREADABLE", "The uploaded file is missing xl/workbook.xml.");
    }
    const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
    const sharedStringsXml = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? null;

    const workbookParsed = parser.parse(workbookXml);
    const sheetsRaw = asArray(workbookParsed?.workbook?.sheets?.sheet);
    const sheetRefs: WorkbookSheetRef[] = sheetsRaw.map((s: Record<string, unknown>) => ({
      name: String(s["@_name"] ?? ""),
      relId: String(s["@_id"] ?? ""),
    }));

    const relTargets = new Map<string, string>();
    if (relsXml) {
      const relsParsed = parser.parse(relsXml);
      const rels = asArray(relsParsed?.Relationships?.Relationship);
      for (const rel of rels) {
        const id = String(rel["@_Id"] ?? "");
        const target = String(rel["@_Target"] ?? "");
        if (id) relTargets.set(id, target);
      }
    }

    const sharedStrings = readSharedStrings(sharedStringsXml);

    return new XlsxDocument(zip, sharedStrings, sheetRefs, relTargets);
  }

  getSheetNames(): string[] {
    return this.sheetRefs.map((s) => s.name);
  }

  private resolveSheetPath(sheetName: string): string {
    const ref = this.sheetRefs.find((s) => s.name === sheetName);
    if (!ref) {
      throw new ValidationError("SHEET_NOT_FOUND", `Worksheet "${sheetName}" was not found in the workbook.`);
    }
    const target = this.relTargets.get(ref.relId);
    if (target) {
      return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    }
    // Fallback: OOXML convention when relationships are absent.
    const index = this.sheetRefs.indexOf(ref) + 1;
    return `xl/worksheets/sheet${index}.xml`;
  }

  /** Returns rows as sparse arrays of raw cell text, 0-indexed by column (index 0 == column A). */
  async getRows(sheetName: string): Promise<(string | null)[][]> {
    const path = this.resolveSheetPath(sheetName);
    const xml = await this.zip.file(path)?.async("string");
    if (!xml) {
      throw new ValidationError("FILE_UNREADABLE", `Worksheet XML not found at ${path}.`);
    }
    const parsed = parser.parse(xml);
    const rowsRaw = asArray(parsed?.worksheet?.sheetData?.row);

    const rows: (string | null)[][] = [];
    let sequentialRowIndex = 0;

    for (const rowRaw of rowsRaw) {
      sequentialRowIndex += 1;
      const rowNumber = rowRaw["@_r"] !== undefined ? Number(rowRaw["@_r"]) : sequentialRowIndex;
      const cellsRaw = asArray(rowRaw.c);
      const cellValues: CellValue[] = [];
      let autoCol = 0;

      for (const cellRaw of cellsRaw) {
        autoCol += 1;
        const ref = cellRaw["@_r"] as string | undefined;
        const col = ref ? splitCellRef(ref).col : autoCol;
        autoCol = col;
        const type = (cellRaw["@_t"] as string | undefined) ?? "n";
        cellValues.push({ col, text: this.extractCellText(cellRaw, type) });
      }

      const maxCol = cellValues.reduce((m, c) => Math.max(m, c.col), 0);
      const rowArray: (string | null)[] = new Array(maxCol).fill(null);
      for (const cv of cellValues) rowArray[cv.col - 1] = cv.text;

      while (rows.length < rowNumber - 1) rows.push([]);
      rows[rowNumber - 1] = rowArray;
    }

    return rows;
  }

  private extractCellText(cellRaw: Record<string, unknown>, type: string): string | null {
    if (type === "inlineStr") {
      const is = cellRaw["is"] as { t?: unknown } | undefined;
      return is ? textNodeToString(is.t) : null;
    }

    const vRaw = cellRaw["v"];
    if (vRaw === undefined) return null;
    const v = textNodeToString(vRaw);

    if (type === "s") {
      const idx = Number(v);
      return this.sharedStrings[idx] ?? null;
    }
    if (type === "b") {
      return v === "1" ? "TRUE" : "FALSE";
    }
    // "n" (number), "str" (formula string result), "e" (error): raw text is sufficient.
    return v;
  }
}
