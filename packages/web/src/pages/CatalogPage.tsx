import { useEffect, useMemo, useRef, useState } from "react";
import {
  Layers,
  Download,
  Search,
  Columns,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
} from "lucide-react";
import { api, ApiRequestError, type FileRecord, type MivaCatalogRow } from "../api";
import { InstructionsCard } from "../components/InstructionsCard";
import { ErrorBanner } from "../components/ErrorBanner";
import { loadFromStorage, saveToStorage } from "../lib/storage";

interface ColumnDef {
  key: string;
  label: string;
  get: (r: MivaCatalogRow) => string;
  defaultWidth: number;
  /** false for columns that aren't plain text (image, link) -- skips the per-column filter dropdown. */
  filterable?: boolean;
  render?: (r: MivaCatalogRow) => React.ReactNode;
  title?: string;
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

// A near-unique column (GTIN, MPN, product code) can have thousands of
// distinct values -- rendering all of them as checkboxes in the filter
// popover is what actually made it "not open": it does open, it's just
// synchronously rendering thousands of DOM nodes first. Same fix as the
// main table's row windowing, just capped instead of scrolled: show the
// first N and tell the user to type to narrow down further.
const MAX_FILTER_VALUES_SHOWN = 200;

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
        <a
          href={r.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={r.productUrl}
          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          Open <ExternalLink size={12} />
        </a>
      ) : (
        "-"
      ),
  },
  { key: "productName", label: "Product name", get: (r) => r.productName ?? "", defaultWidth: 260 },
  { key: "productType", label: "Product type", get: (r) => r.productType ?? "", defaultWidth: 110 },
  { key: "gtin", label: "GTIN", get: (r) => r.gtinRaw ?? "", defaultWidth: 130, title: "Global Trade Item Number (barcode)" },
  { key: "mpn", label: "MPN", get: (r) => r.mpnRaw ?? "", defaultWidth: 110, title: "Manufacturer Part Number" },
  { key: "brand", label: "Brand", get: (r) => r.brandRaw ?? "", defaultWidth: 130 },
  {
    key: "simpleInventory",
    label: "Simple inventory",
    get: (r) => r.currentSimpleInventory ?? "",
    defaultWidth: 140,
    title: "This product's current in-stock/out-of-stock status in Miva.",
  },
  {
    key: "availability",
    label: "Availability",
    get: (r) => r.currentAvailability ?? "",
    defaultWidth: 120,
    title: "Whether this product can currently be ordered in Miva.",
  },
  { key: "restockMessage", label: "Restock message", get: (r) => r.currentRestockMessage ?? "", defaultWidth: 160 },
  {
    key: "dataFeed",
    label: "Datafeed",
    get: (r) => r.currentDataFeed ?? "",
    defaultWidth: 100,
    title: "Whether this product is included in Miva's data feed exports.",
  },
  {
    key: "shoppingFeed",
    label: "Shopping feed",
    get: (r) => r.currentShoppingFeed ?? "",
    defaultWidth: 120,
    title: "Whether this product is included in shopping/comparison feed exports.",
  },
  {
    key: "reportFlag",
    label: "Report flag",
    get: (r) => r.currentReportFlag ?? "",
    defaultWidth: 110,
    title: "An internal Miva reporting flag on this product.",
  },
];

export default function CatalogPage() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [rows, setRows] = useState<MivaCatalogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mivaApiConfigured, setMivaApiConfigured] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullMessage, setPullMessage] = useState<string | null>(null);
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

  function loadFiles(selectId?: string) {
    api.listFiles("miva_snapshot").then((f) => {
      setFiles(f);
      if (selectId) setSelectedFile(selectId);
      else if (f[0] && !selectedFile) setSelectedFile(f[0].id);
    });
  }

  useEffect(() => {
    loadFiles();
    api.getMivaApiStatus().then((s) => setMivaApiConfigured(s.configured));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pullLatest() {
    setPulling(true);
    setPullMessage(null);
    setError(null);
    try {
      const result = await api.pullMivaSnapshot();
      setPullMessage(
        result.duplicateWarning ?? `Pulled: ${result.file.originalFilename} (${result.file.rowCount ?? "?"} rows)`,
      );
      loadFiles(result.file.id);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to pull catalog from Miva.");
    } finally {
      setPulling(false);
    }
  }

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
        (r.gtinRaw ?? "").toLowerCase().includes(needle) ||
        (r.mpnRaw ?? "").toLowerCase().includes(needle),
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
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Layers size={24} strokeWidth={2.25} /> Miva Catalog
      </h2>
      <InstructionsCard
        pageKey="catalog"
        description="A read-only browser for a Miva catalog snapshot -- the same kind of file used as the 'Miva Catalog Data' input on Home, but here purely for inspecting what's currently in Miva. Each snapshot is a point-in-time export; pull a fresh one below instead of trusting an old one if you need the current state."
        steps={[
          "Pick a snapshot from the dropdown, or click Pull latest catalog to fetch the current one from Miva.",
          "Search by product code, name, GTIN, or MPN, or use the funnel on any column header to filter its values.",
          "Click a column header to sort, drag its right edge to resize, and use Columns to show or hide any of them.",
        ]}
      />
      {error && <ErrorBanner message={error} />}
      {pullMessage && <p style={{ fontSize: 13, color: "var(--muted)" }}>{pullMessage}</p>}

      <div className="card">
        <div className="toolbar" style={{ flexWrap: "wrap" }}>
          <label>
            Snapshot:{" "}
            <select value={selectedFile} onChange={(e) => setSelectedFile(e.target.value)} style={{ maxWidth: 320 }}>
              <option value="">Select a snapshot...</option>
              {files.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.originalFilename} ({f.rowCount} rows, {new Date(f.uploadedAt).toLocaleString()})
                </option>
              ))}
            </select>
          </label>
          {mivaApiConfigured && (
            <button
              className="charcoal"
              onClick={pullLatest}
              disabled={pulling}
              style={{ marginLeft: 16, whiteSpace: "nowrap", flex: "none" }}
            >
              <Download size={16} /> {pulling ? "Pulling..." : "Pull latest catalog"}
            </button>
          )}
          <div className="search-input" style={{ marginLeft: 16 }}>
            <Search size={14} />
            <input
              type="text"
              placeholder="Search product code / name / GTIN / MPN"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="columns-menu-wrap" style={{ position: "relative", marginLeft: 16 }}>
            <button onClick={() => setColumnsMenuOpen((v) => !v)}>
              <Columns size={16} /> Columns
            </button>
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
          <span style={{ marginLeft: "auto", color: "var(--muted)", whiteSpace: "nowrap" }}>
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
                  const shownValues = visibleValues.slice(0, MAX_FILTER_VALUES_SHOWN);
                  const truncatedCount = visibleValues.length - shownValues.length;
                  return (
                    <th
                      key={col.key}
                      style={{
                        zIndex: 2,
                        position: "sticky",
                        top: 0,
                        // Clipped so a long label ellipsizes instead of
                        // overflowing into the next column -- but that same
                        // clipping was hiding the filter popover below it,
                        // which is what made every filter dropdown (not just
                        // high-cardinality ones) look like it wasn't opening.
                        // Let it escape while this column's popover is open.
                        overflow: openFilterColumn === col.key ? "visible" : "hidden",
                      }}
                    >
                      <div className="col-filter-wrap" style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
                        <span
                          onClick={() => toggleSort(col.key)}
                          title={col.title}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            cursor: "pointer",
                            userSelect: "none",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {col.label}
                          {sortKey === col.key && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
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
                              background: active ? "var(--brand-soft)" : "transparent",
                              borderColor: active ? "var(--blue)" : undefined,
                            }}
                          >
                            <ChevronDown size={12} />
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
                                <div style={{ fontSize: 12, color: "var(--muted-2)", padding: "4px 0" }}>No values</div>
                              )}
                              {shownValues.map((val) => (
                                <label key={val} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "2px 0" }}>
                                  <input type="checkbox" checked={selectedSet.has(val)} onChange={() => toggleValue(col.key, val)} />
                                  {val}
                                </label>
                              ))}
                              {truncatedCount > 0 && (
                                <div style={{ fontSize: 11, color: "var(--muted-2)", padding: "4px 0 0", fontStyle: "italic" }}>
                                  +{truncatedCount} more -- type above to narrow down
                                </div>
                              )}
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
