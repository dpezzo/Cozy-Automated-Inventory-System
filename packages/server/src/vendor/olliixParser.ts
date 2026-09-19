import type { VendorRawRow, WarehouseCode } from "@cozywinters/shared";
import { OLLIIX_WAREHOUSE_CODES } from "@cozywinters/shared";
import { ValidationError } from "../errors";
import { XlsxDocument } from "./xlsxReader";

const REQUIRED_SHEET = "Item Inventory";

type LogicalColumn =
  | "ITEM_NO"
  | "UPC"
  | "DESCRIPTION"
  | "TOTAL_QTY"
  | `${WarehouseCode}_INV_QTY`
  | `${WarehouseCode}_INCOMING_DATE`
  | `${WarehouseCode}_INCOMING_QTY`;

const ALL_LOGICAL_COLUMNS: LogicalColumn[] = [
  "ITEM_NO",
  "UPC",
  "DESCRIPTION",
  "TOTAL_QTY",
  ...OLLIIX_WAREHOUSE_CODES.flatMap((w) => [
    `${w}_INV_QTY` as LogicalColumn,
    `${w}_INCOMING_DATE` as LogicalColumn,
    `${w}_INCOMING_QTY` as LogicalColumn,
  ]),
];

function forwardFill(values: (string | null)[]): (string | null)[] {
  let last: string | null = null;
  return values.map((v) => {
    if (v !== null && v.trim() !== "") last = v;
    return last;
  });
}

interface ColumnMap {
  byIndex: Map<number, LogicalColumn>;
}

function buildColumnMap(headerRow1: (string | null)[], headerRow2: (string | null)[]): ColumnMap {
  const groupFilled = forwardFill(headerRow1);
  const byIndex = new Map<number, LogicalColumn>();

  for (let i = 0; i < headerRow2.length; i++) {
    const sub = (headerRow2[i] ?? "").trim();
    const group = (groupFilled[i] ?? "").trim();

    if (sub === "Item No") byIndex.set(i, "ITEM_NO");
    else if (sub === "UPC") byIndex.set(i, "UPC");
    else if (sub === "Brief Description") byIndex.set(i, "DESCRIPTION");
    else if (sub === "Total Inv Qty") byIndex.set(i, "TOTAL_QTY");
    else if ((group === "WDC" || group === "SD3" || group === "SD2") && sub === "Inv Qty") {
      byIndex.set(i, `${group as WarehouseCode}_INV_QTY`);
    } else if ((group === "WDC" || group === "SD3" || group === "SD2") && sub === "Incoming Date") {
      byIndex.set(i, `${group as WarehouseCode}_INCOMING_DATE`);
    } else if ((group === "WDC" || group === "SD3" || group === "SD2") && sub === "Incoming Qty") {
      byIndex.set(i, `${group as WarehouseCode}_INCOMING_QTY`);
    }
  }

  return { byIndex };
}

export interface ParsedOlliixWorkbook {
  rows: VendorRawRow[];
}

export async function parseOlliixWorkbook(buffer: Buffer): Promise<ParsedOlliixWorkbook> {
  const doc = await XlsxDocument.load(buffer);

  if (!doc.getSheetNames().includes(REQUIRED_SHEET)) {
    throw new ValidationError(
      "SHEET_NOT_FOUND",
      `Required worksheet "${REQUIRED_SHEET}" was not found in the uploaded workbook.`,
    );
  }

  const allRows = await doc.getRows(REQUIRED_SHEET);
  const row1 = allRows[0] ?? [];
  const row2 = allRows[1] ?? [];

  const columnMap = buildColumnMap(row1, row2);
  const found = new Set(columnMap.byIndex.values());
  const missing = ALL_LOGICAL_COLUMNS.filter((c) => !found.has(c));
  if (missing.length > 0) {
    throw new ValidationError(
      "REQUIRED_COLUMNS_MISSING",
      `The Item Inventory sheet is missing required columns: ${missing.join(", ")}.`,
      { missing },
    );
  }

  const indexOf = (col: LogicalColumn): number => {
    for (const [idx, mapped] of columnMap.byIndex) {
      if (mapped === col) return idx;
    }
    throw new ValidationError("REQUIRED_COLUMNS_MISSING", `Column ${col} unexpectedly missing.`);
  };

  const idx = {
    ITEM_NO: indexOf("ITEM_NO"),
    UPC: indexOf("UPC"),
    DESCRIPTION: indexOf("DESCRIPTION"),
    TOTAL_QTY: indexOf("TOTAL_QTY"),
  };
  const warehouseIdx: Record<(typeof OLLIIX_WAREHOUSE_CODES)[number], { inv: number; date: number; qty: number }> = {
    WDC: { inv: indexOf("WDC_INV_QTY"), date: indexOf("WDC_INCOMING_DATE"), qty: indexOf("WDC_INCOMING_QTY") },
    SD3: { inv: indexOf("SD3_INV_QTY"), date: indexOf("SD3_INCOMING_DATE"), qty: indexOf("SD3_INCOMING_QTY") },
    SD2: { inv: indexOf("SD2_INV_QTY"), date: indexOf("SD2_INCOMING_DATE"), qty: indexOf("SD2_INCOMING_QTY") },
  };

  const rows: VendorRawRow[] = [];

  // Data starts at row 3 (rows 1-2 are the two-row header). allRows is 0-indexed.
  for (let rowNumber = 3; rowNumber <= allRows.length; rowNumber++) {
    const dataRow = allRows[rowNumber - 1] ?? [];
    const cellText = (index: number): string | null => dataRow[index] ?? null;

    const itemNoRaw = cellText(idx.ITEM_NO);
    const upcRaw = cellText(idx.UPC);
    const descriptionRaw = cellText(idx.DESCRIPTION);
    const totalQtyRaw = cellText(idx.TOTAL_QTY);

    const isBlankRow =
      (itemNoRaw === null || itemNoRaw.trim() === "") &&
      (upcRaw === null || upcRaw.trim() === "") &&
      (descriptionRaw === null || descriptionRaw.trim() === "") &&
      (totalQtyRaw === null || totalQtyRaw.trim() === "");
    if (isBlankRow) continue;

    const warehouses = {} as NonNullable<VendorRawRow["warehouses"]>;
    for (const code of OLLIIX_WAREHOUSE_CODES) {
      warehouses[code] = {
        invQtyRaw: cellText(warehouseIdx[code].inv),
        incomingDateRaw: cellText(warehouseIdx[code].date),
        incomingQtyRaw: cellText(warehouseIdx[code].qty),
      };
    }

    rows.push({
      sourceRowNumber: rowNumber,
      itemNoRaw,
      upcRaw,
      descriptionRaw,
      totalQtyRaw,
      warehouses,
    });
  }

  if (rows.length === 0) {
    throw new ValidationError("ZERO_DATA_ROWS", "The Item Inventory sheet contains zero usable data rows.");
  }

  return { rows };
}
