import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiRequestError, type FileRecord, type MivaCatalogRow } from "../api";

interface ColumnDef {
  key: string;
  label: string;
  get: (r: MivaCatalogRow) => string;
  defaultWidth: number;
  /** false for columns that aren't plain text (image, link) -- skips the per-column filter dropdown. */
  filterable?: boolean;
  render?: (r: MivaCatalogRow) => React.ReactNode;
}

const HIDDEN_COLUMNS_KEY = "cw-catalog-hidden-columns-v1";
const COLUMN_WIDTHS_KEY = "cw-catalog-column-widths-v1";

// Fixed row height + windowing: with ~8,000 rows, rendering every <tr> makes
// any state change (a column toggle, a filter, a sort) feel laggy, since the
// browser can't paint until the whole table has been re-rendered and
// reconciled. Only rows actually scrolled into view (plus overscan) are
// rendered as real <tr> elements; two spacer rows hold the scrollbar's
// correct total height.
const ROW_HEIGHT = 52;
const OVERSCAN = 8;

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // per-viewer convenience only -- fine to silently skip if storage is unavailable
  }
}

function CopyableCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [hover, setHover] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard API unavailable (e.g. insecure context) -- nothing more we can do
    }
  }

  if (!value) return <>-</>;
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
    >
      {value}
      {hover && (
        <button
          onClick={copy}
          title="Copy product code"
          style={{ padding: "0 4px", fontSize: 11, lineHeight: "16px" }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </span>
  );
}

const COLUMNS: ColumnDef[] = [
  {
    key: "thumbnail",
    label: "Image",
    get: () => "",
    defaultWidth: 60,
    filterable: false,
    render: (r) =>
      r.thumbnailUrl ? (
        <img
          src={r.thumbnailUrl}
          alt=""
          style={{ height: 40, maxWidth: 40, objectFit: "contain", display: "block" }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
      ) : (
        ""
      ),
  },
  {
    key: "productCode",
    label: "Product code",
    get: (r) => r.productCode ?? "",
    defaultWidth: 160,
    render: (r) => <CopyableCode value={r.productCode ?? ""} />,
  },
  {
    key: "productUrl",
    label: "URL",
    get: (r) => r.productUrl ?? "",
    defaultWidth: 70,
    filterable: false,
    render: (r) =>
      r.productUrl ? (
        <a href={r.productUrl} target="_blank" rel="noopener noreferrer" title={r.productUrl}>
          Open ↗
        </a>
      ) : (
        "-"
      ),
  },
  { key: "productName", label: "Product name", get: (r) => r.productName ?? "", defaultWidth: 260 },
  { key: "productType", label: "Product type", get: (r) => r.productType ?? "", defaultWidth: 110 },
  { key: "gtin", label: "GTIN", get: (r) => r.gtinRaw ?? "", defaultWidth: 130 },
  { key: "mpn", label: "MPN", get: (r) => r.mpnRaw ?? "", defaultWidth: 110 },
  { key: "brand", label: "Brand", get: (r) => r.brandRaw ?? "", defaultWidth: 130 },
  { key: "simpleInventory", label: "Simple inventory", get: (r) => r.currentSimpleInventory ?? "", defaultWidth: 140 },
  { key: "availability", label: "Availability", get: (r) => r.currentAvailability ?? "", defaultWidth: 120 },
  { key: "restockMessage", label: "Restock message", get: (r) => r.currentRestockMessage ?? "", defaultWidth: 160 },
  { key: "dataFeed", label: "Datafeed", get: (r) => r.currentDataFeed ?? "", defaultWidth: 100 },
  { key: "shoppingFeed", label: "Shopping feed", get: (r) => r.currentShoppingFeed ?? "", defaultWidth: 120 },
  { key: "reportFlag", label: "Report flag", get: (r) => r.currentReportFlag ?? "", defaultWidth: 110 },
];

export default function CatalogPage() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [rows, setRows] = useState<MivaCatalogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [columnFilterValues, setColumnFilterValues] = useState<Record<string, Set<string>>>({});
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null);
  const [popoverSearch, setPopoverSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    () => new Set(loadFromStorage<string[]>(HIDDEN_COLUMNS_KEY, [])),
  );
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() =>
    loadFromStorage<Record<string, number>>(COLUMN_WIDTHS_KEY, {}),
  );
  const resizing = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fill the rest of the viewport below the table's own top offset, instead
  // of the shared .table-scroll class's fixed 65vh cap, which leaves a lot of
  // dead space on a tall browser window. The trailing 64px accounts for the
  // space still below the scroll container: the enclosing .card's bottom
  // padding and margin (20px + 20px) plus .main's bottom padding (24px) --
  // without it the page was ~40px taller than the viewport, forcing a whole
  // second (outer) scrollbar even though only the row list needs to scroll.
  useEffect(() => {
    function recomputeHeight() {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setContainerHeight(Math.max(240, window.innerHeight - top - 64));
    }
    recomputeHeight();
    window.addEventListener("resize", recomputeHeight);
    return () => window.removeEventListener("resize", recomputeHeight);
  }, []);

  useEffect(() => {
    api.listFiles("miva_snapshot").then((f) => {
      setFiles(f);
      if (f[0]) setSelectedFile(f[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    setColumnFilterValues({});
    setSortKey(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
    api
      .getCatalogRows(selectedFile)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to load catalog."))
      .finally(() => setLoading(false));
  }, [selectedFile]);

  function displayValue(raw: string): string {
    return raw === "" ? "(Blank)" : raw;
  }

  const searched = useMemo(() => {
    if (!search) return rows;
    const needle = search.toLowerCase();
    return rows.filter(
      (r) =>
        (r.productCode ?? "").toLowerCase().includes(needle) ||
        (r.productName ?? "").toLowerCase().includes(needle) ||
        (r.gtinRaw ?? "").toLowerCase().includes(needle),
    );
  }, [rows, search]);

  const filterableColumns = useMemo(() => COLUMNS.filter((c) => c.filterable !== false), []);

  const distinctValuesByColumn = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of filterableColumns) {
      const set = new Set<string>();
      for (const r of searched) set.add(displayValue(col.get(r)));
      map[col.key] = Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    return map;
  }, [searched, filterableColumns]);

  function effectiveSelectedFor(colKey: string): Set<string> {
    return columnFilterValues[colKey] ?? new Set(distinctValuesByColumn[colKey] ?? []);
  }

  function toggleValue(colKey: string, value: string) {
    setColumnFilterValues((prev) => {
      const current = new Set(prev[colKey] ?? distinctValuesByColumn[colKey] ?? []);
      if (current.has(value)) current.delete(value);
      else current.add(value);
      const next = { ...prev };
      const allValues = distinctValuesByColumn[colKey] ?? [];
      if (current.size === allValues.length) delete next[colKey];
      else next[colKey] = current;
      return next;
    });
  }

  function selectAllColumn(colKey: string) {
    setColumnFilterValues((prev) => {
      const next = { ...prev };
      delete next[colKey];
      return next;
    });
  }

  function deselectAllColumn(colKey: string) {
    setColumnFilterValues((prev) => ({ ...prev, [colKey]: new Set() }));
  }

  function toggleSort(key: string) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir("asc");
    }
  }

  function toggleColumnVisibility(key: string) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveToStorage(HIDDEN_COLUMNS_KEY, [...next]);
      return next;
    });
  }

  function widthFor(key: string, fallback: number): number {
    return columnWidths[key] ?? fallback;
  }

  function startResize(e: React.MouseEvent, key: string, currentWidth: number) {
    e.preventDefault();
    resizing.current = { key, startX: e.clientX, startWidth: currentWidth };
    function onMove(ev: MouseEvent) {
      if (!resizing.current) return;
      const delta = ev.clientX - resizing.current.startX;
      const newWidth = Math.max(40, resizing.current.startWidth + delta);
      setColumnWidths((prev) => ({ ...prev, [resizing.current!.key]: newWidth }));
    }
    function onUp() {
      if (resizing.current) {
        setColumnWidths((prev) => {
          saveToStorage(COLUMN_WIDTHS_KEY, prev);
          return prev;
        });
      }
      resizing.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  useEffect(() => {
    if (!openFilterColumn && !columnsMenuOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (openFilterColumn && !target.closest(".col-filter-wrap")) setOpenFilterColumn(null);
      if (columnsMenuOpen && !target.closest(".columns-menu-wrap")) setColumnsMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openFilterColumn, columnsMenuOpen]);

  const displayedRows = useMemo(() => {
    let result = searched;
    for (const col of filterableColumns) {
      const allowed = columnFilterValues[col.key];
      if (allowed) result = result.filter((r) => allowed.has(displayValue(col.get(r))));
    }
    if (sortKey) {
      const col = COLUMNS.find((c) => c.key === sortKey);
      if (col) {
        result = [...result].sort((a, b) => {
          const av = col.get(a);
          const bv = col.get(b);
          const an = Number(av);
          const bn = Number(bv);
          const bothNumeric = av !== "" && bv !== "" && !Number.isNaN(an) && !Number.isNaN(bn);
          const cmp = bothNumeric ? an - bn : av.localeCompare(bv);
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }
    return result;
  }, [searched, columnFilterValues, sortKey, sortDir, filterableColumns]);

  const hasColumnFilters = Object.keys(columnFilterValues).length > 0;
  const visibleColumns = COLUMNS.filter((c) => !hiddenColumns.has(c.key));

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    displayedRows.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const windowedRows = displayedRows.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * ROW_HEIGHT;
  const bottomSpacerHeight = (displayedRows.length - endIndex) * ROW_HEIGHT;

  return (
    <div>
      <h2>Miva Catalog</h2>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="toolbar">
          <label>
            Snapshot:{" "}
            <select value={selectedFile} onChange={(e) => setSelectedFile(e.target.value)}>
              <option value="">Select a snapshot...</option>
              {files.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.originalFilename} ({f.rowCount} rows, {new Date(f.uploadedAt).toLocaleString()})
                </option>
              ))}
            </select>
          </label>
          <input
            type="text"
            placeholder="Search product code / name / GTIN"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginLeft: 16 }}
          />
          <div className="columns-menu-wrap" style={{ position: "relative", marginLeft: 16 }}>
            <button onClick={() => setColumnsMenuOpen((v) => !v)}>Columns</button>
            {columnsMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  background: "white",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                  padding: 8,
                  width: 200,
                  zIndex: 20,
                  maxHeight: 320,
                  overflow: "auto",
                }}
              >
                {COLUMNS.map((col) => (
                  <label key={col.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 0" }}>
                    <input
                      type="checkbox"
                      checked={!hiddenColumns.has(col.key)}
                      onChange={() => toggleColumnVisibility(col.key)}
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <span style={{ marginLeft: "auto", color: "#64748b", whiteSpace: "nowrap" }}>
            {loading ? "Loading..." : `Showing ${displayedRows.length} of ${rows.length} product${rows.length === 1 ? "" : "s"}`}
            {hasColumnFilters && (
              <>
                {" "}
                ·{" "}
                <button style={{ padding: "2px 8px" }} onClick={() => setColumnFilterValues({})}>
                  Clear column filters
                </button>
              </>
            )}
          </span>
        </div>

        <div
          className="table-scroll"
          ref={scrollRef}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          style={{ height: containerHeight, maxHeight: containerHeight }}
        >
          <table style={{ tableLayout: "fixed" }}>
            <colgroup>
              {visibleColumns.map((col) => (
                <col key={col.key} style={{ width: widthFor(col.key, col.defaultWidth) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {visibleColumns.map((col) => {
                  const active = Boolean(columnFilterValues[col.key]);
                  const allValues = distinctValuesByColumn[col.key] ?? [];
                  const selectedSet = effectiveSelectedFor(col.key);
                  const visibleValues = popoverSearch
                    ? allValues.filter((v) => v.toLowerCase().includes(popoverSearch.toLowerCase()))
                    : allValues;
                  return (
                    <th key={col.key} style={{ zIndex: 2, position: "sticky", top: 0, overflow: "hidden" }}>
                      <div className="col-filter-wrap" style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
                        <span
                          onClick={() => toggleSort(col.key)}
                          style={{ cursor: "pointer", userSelect: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        >
                          {col.label}
                          {sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </span>
                        {col.filterable !== false && (
                          <button
                            onClick={() => {
                              setOpenFilterColumn(openFilterColumn === col.key ? null : col.key);
                              setPopoverSearch("");
                            }}
                            title="Filter values"
                            style={{
                              marginLeft: "auto",
                              padding: "0 4px",
                              fontSize: 11,
                              fontWeight: "normal",
                              background: active ? "#dbeafe" : "transparent",
                              borderColor: active ? "var(--blue)" : undefined,
                            }}
                          >
                            {"▾"}
                          </button>
                        )}
                        {openFilterColumn === col.key && (
                          <div
                            style={{
                              position: "absolute",
                              top: "100%",
                              left: 0,
                              background: "white",
                              border: "1px solid var(--border)",
                              borderRadius: 6,
                              boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                              padding: 8,
                              width: 220,
                              zIndex: 10,
                              fontWeight: "normal",
                              cursor: "default",
                              textTransform: "none",
                            }}
                          >
                            <input
                              type="text"
                              value={popoverSearch}
                              onChange={(e) => setPopoverSearch(e.target.value)}
                              placeholder="Search values..."
                              style={{ width: "100%", fontSize: 12, padding: "3px 5px", marginBottom: 6 }}
                            />
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                              <button style={{ padding: "1px 6px", fontSize: 11 }} onClick={() => selectAllColumn(col.key)}>
                                Select all
                              </button>
                              <button style={{ padding: "1px 6px", fontSize: 11 }} onClick={() => deselectAllColumn(col.key)}>
                                Deselect all
                              </button>
                            </div>
                            <div style={{ maxHeight: 200, overflow: "auto", borderTop: "1px solid var(--border)", paddingTop: 4 }}>
                              {visibleValues.length === 0 && (
                                <div style={{ fontSize: 12, color: "#94a3b8", padding: "4px 0" }}>No values</div>
                              )}
                              {visibleValues.map((val) => (
                                <label key={val} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "2px 0" }}>
                                  <input type="checkbox" checked={selectedSet.has(val)} onChange={() => toggleValue(col.key, val)} />
                                  {val}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <div
                        onMouseDown={(e) => startResize(e, col.key, widthFor(col.key, col.defaultWidth))}
                        style={{
                          position: "absolute",
                          top: 0,
                          right: 0,
                          bottom: 0,
                          width: 6,
                          cursor: "col-resize",
                          userSelect: "none",
                        }}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {topSpacerHeight > 0 && (
                <tr style={{ height: topSpacerHeight }}>
                  <td colSpan={visibleColumns.length} style={{ padding: 0, border: "none" }} />
                </tr>
              )}
              {windowedRows.map((r) => (
                <tr key={r.sourceRowNumber} style={{ height: ROW_HEIGHT }}>
                  {visibleColumns.map((col) => (
                    <td key={col.key} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {col.render ? col.render(r) : col.get(r) || "-"}
                    </td>
                  ))}
                </tr>
              ))}
              {bottomSpacerHeight > 0 && (
                <tr style={{ height: bottomSpacerHeight }}>
                  <td colSpan={visibleColumns.length} style={{ padding: 0, border: "none" }} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
