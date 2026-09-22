import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type AuditLogRecord, type FileRecord, type RunRecord, type LegacyComparisonRow, type LegacyComparisonValues } from "../api";
import { UploadBox } from "../components/UploadBox";
import { StepHeader } from "../components/StepBadge";
import { InstructionsCard } from "../components/InstructionsCard";
import { useAuth } from "../AuthContext";
import { loadFromStorage, saveToStorage } from "../lib/storage";

const DIFF_HIDDEN_COLUMNS_KEY = "cw-legacydiff-hidden-columns-v1";

const COMPARISON_CLASS_FILTERS = ["EXACT_MATCH", "APPROVED_DEVIATION", "UNEXPLAINED_DIFFERENCE", "NOT_COMPARABLE"];

const COMPARISON_CLASS_PILL: Record<string, string> = {
  EXACT_MATCH: "clean",
  APPROVED_DEVIATION: "approved",
  UNEXPLAINED_DIFFERENCE: "blocked",
  NOT_COMPARABLE: "unchanged",
};

/** Same six managed fields RunReviewPage's diffFields compares, plus the expected date -- lists which ones differ between the app's own calculation (or, when there isn't one, Miva's current value) and what the legacy workbook recorded. */
const VALUE_FIELD_LABELS: Record<keyof LegacyComparisonValues, string> = {
  simpleInventory: "Status",
  availability: "Availability",
  restockMessage: "Restock",
  dataFeed: "Datafeed",
  shoppingFeed: "Shopping feed",
  reportFlag: "Report flag",
  expectedDate: "Expected date",
};

/**
 * A Miva-only orphan row (in Miva + the legacy file, but not the vendor
 * file -- e.g. an NLA candidate not yet marked discontinued) never gets a
 * calculated our_values: row.proposed is never populated for it. Falling
 * back to miva_values keeps the comparison meaningful for that population
 * instead of silently reporting "no differences" just because nothing was
 * calculated.
 */
function referenceValues(r: LegacyComparisonRow): LegacyComparisonValues | null {
  return r.our_values ?? r.miva_values;
}

function fieldMismatch(r: LegacyComparisonRow, field: keyof LegacyComparisonValues): boolean {
  const ours = referenceValues(r);
  if (!ours || !r.legacy_values) return false;
  // Miva never tracks an expected-date equivalent (mivaValuesFrom always
  // leaves it null) -- when the reference value is Miva's current value
  // (no calculated our_values exists), comparing that always-null field
  // against a real legacy value would falsely flag a "difference" every
  // time, so it's excluded from that fallback comparison specifically.
  if (field === "expectedDate" && r.our_values === null) return false;
  return (ours[field] ?? "").trim() !== (r.legacy_values[field] ?? "").trim();
}

function diffValueFields(r: LegacyComparisonRow): string[] {
  return (Object.keys(VALUE_FIELD_LABELS) as (keyof LegacyComparisonValues)[])
    .filter((f) => fieldMismatch(r, f))
    .map((f) => VALUE_FIELD_LABELS[f]);
}

/** item_no is only ever populated for vendor-matched rows (reconcile.ts's pass 1) -- pass 2's Miva-only orphan rows always leave it null, which is the reliable signal for "not in the vendor file" (their raw_upc is Miva's own GTIN/MPN, not a vendor-file value). */
function rowOrigin(r: LegacyComparisonRow): "Vendor + Miva" | "Miva only" {
  return r.item_no !== null ? "Vendor + Miva" : "Miva only";
}

interface DiffColumnDef {
  key: string;
  label: string;
  /** Group header label this column sits under -- "" for an ungrouped column. Adjacent visible columns sharing a group are merged into one spanning header cell, so hiding a column re-collapses the span automatically. */
  group: string;
  title: string;
  className?: (r: LegacyComparisonRow) => string;
  render: (r: LegacyComparisonRow) => React.ReactNode;
}

const DIFF_COLUMNS: DiffColumnDef[] = [
  {
    key: "source",
    label: "Source",
    group: "",
    title:
      "Whether this row was matched from the vendor file, or exists in Miva (and the legacy file) with no vendor file counterpart.",
    render: (r) => {
      const origin = rowOrigin(r);
      return <span className={`pill ${origin === "Miva only" ? "warning" : "unchanged"}`}>{origin}</span>;
    },
  },
  {
    key: "productCode",
    label: "Product code",
    group: "Miva",
    title: "Miva catalog snapshot (PRODUCT_CODE), joined via the UPC/SKU match.",
    render: (r) => r.product_code ?? "—",
  },
  {
    key: "itemName",
    label: "Item name",
    group: "Vendor file",
    title: "Vendor file (Olliix 'Brief Description' column) -- blank for a Miva-only row not present in the vendor file.",
    render: (r) => r.item_name ?? "—",
  },
  {
    key: "itemNo",
    label: "Item No",
    group: "Vendor file",
    title: "Vendor file (Olliix 'Item No' column) -- blank for a Miva-only row not present in the vendor file.",
    render: (r) => r.item_no ?? "—",
  },
  {
    key: "upc",
    label: "UPC / SKU",
    group: "Vendor file",
    title:
      "Vendor file for vendor-matched rows; Miva's own identifier (GTIN/MPN) for a Miva-only row not present in the vendor file.",
    render: (r) => r.raw_upc ?? "—",
  },
  {
    key: "class",
    label: "Class",
    group: "",
    title: "Computed classification for this row.",
    render: (r) => <span className={`pill ${COMPARISON_CLASS_PILL[r.comparison_class] ?? "pending"}`}>{r.comparison_class}</span>,
  },
  {
    key: "deviation",
    label: "Deviation",
    group: "",
    title: "Approved deviation register ID, if this row is a known/accepted exception.",
    render: (r) => r.deviation_id ?? "—",
  },
  {
    key: "ourStatus",
    label: "Our status",
    group: "Our calculation",
    title:
      "Calculated by this app's rule engine from the vendor's quantity data -- not copied from Miva or the vendor file. Blank for a Miva-only row not yet marked discontinued (no proposal is computed for it); expand the row to compare Miva's current value against Legacy instead.",
    className: (r) => (fieldMismatch(r, "simpleInventory") ? "cell-mismatch" : ""),
    render: (r) => r.our_values?.simpleInventory ?? "—",
  },
  {
    key: "legacyStatus",
    label: "Legacy status",
    group: "Legacy file",
    title: "Legacy audit CSV (*CUSTOM_SIMPLE_INVENTORY column).",
    className: (r) => (fieldMismatch(r, "simpleInventory") ? "cell-mismatch" : ""),
    render: (r) => r.legacy_values?.simpleInventory ?? "—",
  },
  {
    key: "differingFields",
    label: "Differing fields",
    group: "Computed",
    title: "Fields where Our calculation (or, when blank, Miva's current value) disagrees with the Legacy file.",
    render: (r) => diffValueFields(r).join(", "),
  },
  {
    key: "note",
    label: "Note",
    group: "Computed",
    title: "Generated explanation for this row's classification.",
    render: (r) => r.note || "—",
  },
];

/** Merges adjacent visible columns sharing the same group label into one spanning header cell, so the group header row stays correct as columns are hidden/shown. */
function groupRuns(cols: DiffColumnDef[]): { group: string; span: number }[] {
  const runs: { group: string; span: number }[] = [];
  for (const col of cols) {
    const last = runs[runs.length - 1];
    if (last && last.group === col.group) last.span++;
    else runs.push({ group: col.group, span: 1 });
  }
  return runs;
}

function LegacyComparisonSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [legacyFiles, setLegacyFiles] = useState<FileRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState(searchParams.get("runId") ?? "");
  const [selectedLegacy, setSelectedLegacy] = useState("");
  const [runSearch, setRunSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LegacyComparisonRow[] | null>(null);
  const [classFilter, setClassFilter] = useState<string[]>([]);
  const [rowSearch, setRowSearch] = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    () => new Set(loadFromStorage<string[]>(DIFF_HIDDEN_COLUMNS_KEY, [])),
  );
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);

  useEffect(() => {
    api.listRuns().then(setRuns);
  }, []);

  const loadLegacyFiles = () => {
    api.listFiles("legacy_audit").then(setLegacyFiles);
  };

  useEffect(() => {
    loadLegacyFiles();
  }, []);

  const filteredRuns = useMemo(() => {
    if (!runSearch) return runs;
    return runs.filter((r) => r.id.includes(runSearch) || r.ruleId.includes(runSearch) || r.status.includes(runSearch.toLowerCase()));
  }, [runs, runSearch]);

  function selectRun(runId: string) {
    setSelectedRun(runId);
    setRows(null);
    setSearchParams(runId ? { runId } : {});
  }

  async function runLegacy() {
    if (!selectedRun || !selectedLegacy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.runLegacyComparison(selectedRun, selectedLegacy);
      setRows(result.rows);
    } catch {
      setError("Legacy comparison failed.");
    } finally {
      setBusy(false);
    }
  }

  const legacyResult = useMemo(() => {
    if (!rows) return null;
    const counts = { exact: 0, approved: 0, unexplained: 0, notComparable: 0 };
    for (const r of rows) {
      if (r.comparison_class === "EXACT_MATCH") counts.exact++;
      else if (r.comparison_class === "APPROVED_DEVIATION") counts.approved++;
      else if (r.comparison_class === "UNEXPLAINED_DIFFERENCE") counts.unexplained++;
      else counts.notComparable++;
    }
    return counts;
  }, [rows]);

  function toggleClassFilter(value: string) {
    setClassFilter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  function toggleExpanded(key: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleColumnVisibility(key: string) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveToStorage(DIFF_HIDDEN_COLUMNS_KEY, [...next]);
      return next;
    });
  }

  useEffect(() => {
    if (!columnsMenuOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".columns-menu-wrap")) setColumnsMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [columnsMenuOpen]);

  const visibleDiffColumns = useMemo(() => DIFF_COLUMNS.filter((c) => !hiddenColumns.has(c.key)), [hiddenColumns]);
  const diffHeaderRuns = useMemo(() => groupRuns(visibleDiffColumns), [visibleDiffColumns]);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    let result = rows;
    if (classFilter.length) result = result.filter((r) => classFilter.includes(r.comparison_class));
    if (rowSearch) {
      const q = rowSearch.toLowerCase();
      result = result.filter(
        (r) =>
          (r.product_code ?? "").toLowerCase().includes(q) ||
          (r.item_no ?? "").toLowerCase().includes(q) ||
          (r.item_name ?? "").toLowerCase().includes(q) ||
          (r.raw_upc ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [rows, classFilter, rowSearch]);

  return (
    <div>
      <div className="card">
        <StepHeader step={1} complete={legacyFiles.length > 0} title="Upload legacy audit file" />
        <UploadBox
          kind="legacy_audit"
          label="Upload legacy Olliix_Audit_Master CSV (optional, one-time)"
          hint="Only for the old Excel/Power Query workbook's 'Olliix_Audit_Master' export (columns like SKU, UPC, Expected Date, PRODUCT_CODE). This is a one-time check that the app matches the old system's behavior, not a regular Miva import/export file. Skip this if you don't maintain that workbook — it isn't part of the normal reconciliation workflow."
          onUploaded={loadLegacyFiles}
        />
      </div>

      <div className="card">
        <StepHeader step={2} complete={Boolean(selectedRun)} title="Choose a run" />
        <div className="filters">
          <input
            type="text"
            placeholder="Search by run ID, status, or rule"
            value={runSearch}
            onChange={(e) => setRunSearch(e.target.value)}
            style={{ width: 320 }}
          />
        </div>
        <div className="table-scroll" style={{ maxHeight: 260 }}>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Created</th>
                <th>Run ID</th>
                <th>Status</th>
                <th>Rule / hash</th>
                <th>Run date</th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input type="radio" checked={selectedRun === r.id} onChange={() => selectRun(r.id)} />
                  </td>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td title={r.id}>{r.id.slice(0, 8)}</td>
                  <td>{r.status}</td>
                  <td title={r.ruleConfigHash}>
                    {r.ruleId} / {r.ruleConfigHash.slice(0, 10)}
                  </td>
                  <td>{r.runDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <StepHeader step={3} complete={Boolean(legacyResult)} title="Run legacy comparison" />
        <div className="toolbar">
          <select value={selectedLegacy} onChange={(e) => setSelectedLegacy(e.target.value)}>
            <option value="">Select legacy audit CSV...</option>
            {legacyFiles.map((f) => (
              <option key={f.id} value={f.id}>
                {f.originalFilename}
              </option>
            ))}
          </select>
          <button onClick={runLegacy} disabled={busy || !selectedRun || !selectedLegacy}>
            Run legacy comparison
          </button>
        </div>
        {!selectedRun && <p style={{ fontSize: 13, color: "#64748b" }}>Select a run above first.</p>}
        {legacyResult && (
          <div className="grid cols-4">
            <div className="stat">
              <div className="value">{legacyResult.exact}</div>
              <div className="label">Exact match</div>
            </div>
            <div className="stat">
              <div className="value">{legacyResult.approved}</div>
              <div className="label">Approved deviation</div>
            </div>
            <div className="stat">
              <div className="value">{legacyResult.unexplained}</div>
              <div className="label">Unexplained difference</div>
            </div>
            <div className="stat">
              <div className="value">{legacyResult.notComparable}</div>
              <div className="label">Not comparable</div>
            </div>
          </div>
        )}
      </div>

      {rows && (
        <div className="card">
          <h3>Differences</h3>
          <div className="filters">
            <span style={{ fontWeight: 700 }}>Class:</span>
            {COMPARISON_CLASS_FILTERS.map((c) => (
              <label key={c}>
                <input type="checkbox" checked={classFilter.includes(c)} onChange={() => toggleClassFilter(c)} /> {c}
              </label>
            ))}
            <input
              type="text"
              placeholder="Search item / name / UPC / product code"
              value={rowSearch}
              onChange={(e) => setRowSearch(e.target.value)}
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
                  {DIFF_COLUMNS.map((col) => (
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
              Showing {filteredRows.length} of {rows.length} row{rows.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="table-scroll" style={{ maxHeight: 500 }}>
            <table>
              <thead>
                <tr style={{ fontSize: 11, color: "#64748b" }}>
                  <th></th>
                  {diffHeaderRuns.map((run, i) => (
                    <th key={i} colSpan={run.span}>
                      {run.group}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th></th>
                  {visibleDiffColumns.map((col) => (
                    <th key={col.key} title={col.title}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r, i) => {
                  const key = `${r.product_code ?? "-"}-${r.source_row_number ?? i}`;
                  const expanded = expandedRows.has(key);
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td>
                          <button
                            onClick={() => toggleExpanded(key)}
                            style={{ border: "none", background: "none", cursor: "pointer", padding: 0, fontSize: 12 }}
                            aria-label={expanded ? "Collapse row detail" : "Expand row detail"}
                          >
                            {expanded ? "▾" : "▸"}
                          </button>
                        </td>
                        {visibleDiffColumns.map((col) => (
                          <td key={col.key} className={col.className?.(r) ?? ""}>
                            {col.render(r)}
                          </td>
                        ))}
                      </tr>
                      {expanded && (
                        <tr>
                          <td></td>
                          <td colSpan={visibleDiffColumns.length}>
                            <table style={{ width: "auto", margin: "4px 0" }}>
                              <thead>
                                <tr>
                                  <th>Field</th>
                                  <th title="What Miva already had before this run.">Miva (current)</th>
                                  <th title="What this app calculated -- blank when no proposal was ever computed for this row.">
                                    Our (calculated)
                                  </th>
                                  <th title="What the legacy workbook recorded.">Legacy</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(Object.keys(VALUE_FIELD_LABELS) as (keyof LegacyComparisonValues)[]).map((field) => {
                                  const mismatch = fieldMismatch(r, field);
                                  const usedOurs = r.our_values !== null;
                                  return (
                                    <tr key={field}>
                                      <td>{VALUE_FIELD_LABELS[field]}</td>
                                      <td className={mismatch && !usedOurs ? "cell-mismatch" : ""}>
                                        {r.miva_values?.[field] ?? "—"}
                                      </td>
                                      <td className={mismatch && usedOurs ? "cell-mismatch" : ""}>{r.our_values?.[field] ?? "—"}</td>
                                      <td className={mismatch ? "cell-mismatch" : ""}>{r.legacy_values?.[field] ?? "—"}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={visibleDiffColumns.length + 1} style={{ color: "#64748b" }}>
                      No rows match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Admin-only browser for the audit_log table -- every RUN_CREATED, BATCH_GENERATED, LEGACY_COMPARISON_RUN, VENDOR_CONFIG_*, USER_* etc. event the app already records but, until now, never surfaced anywhere. */
function ActivityLogSection() {
  const [entries, setEntries] = useState<AuditLogRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listAuditLog().then((rows) => {
      setEntries(rows);
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    if (!search) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (e) =>
        e.action.toLowerCase().includes(q) ||
        e.entityType.toLowerCase().includes(q) ||
        (e.actorEmail ?? "").toLowerCase().includes(q),
    );
  }, [entries, search]);

  // Fills the rest of the viewport below the table instead of a fixed
  // maxHeight, so it adapts to the monitor size and to whatever's above it
  // changing height (e.g. the instructions card being expanded/collapsed) --
  // same technique as Run History's tables and the Miva Catalog table.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tableHeight, setTableHeight] = useState(400);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function recompute() {
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      // 64px = the enclosing .card's own bottom padding + margin (20 + 20) plus .main's bottom padding (24).
      setTableHeight(Math.max(200, window.innerHeight - top - 64));
    }
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(document.body);
    window.addEventListener("resize", recompute);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, []);

  return (
    <div className="card">
      <h3>Activity log</h3>
      <div className="filters">
        <input
          type="text"
          placeholder="Search by action, entity type, or user"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 320 }}
        />
        <span style={{ marginLeft: "auto", color: "#64748b" }}>
          Showing {filtered.length} of {entries.length} most recent event{entries.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="table-scroll" ref={scrollRef} style={{ height: tableHeight, maxHeight: tableHeight }}>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString()}</td>
                <td>{e.actorEmail ?? "—"}</td>
                <td>{e.action}</td>
                <td title={e.entityId ?? ""}>{e.entityType}</td>
                <td style={{ fontSize: 12, color: "#64748b" }}>
                  {Object.keys(e.details).length > 0 ? JSON.stringify(e.details) : "-"}
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "#64748b" }}>
                  No activity recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type AuditTab = "legacy-comparison" | "activity-log";

export default function AuditsReviewsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState<AuditTab>("legacy-comparison");

  return (
    <div>
      <h2>Audits &amp; Reviews</h2>
      <InstructionsCard
        pageKey="audits"
        description="A dedicated home for one-time or periodic checks that fall outside the regular reconciliation workflow."
        steps={[
          "Upload the file the audit needs to compare against (e.g. the legacy system's export).",
          "Choose which run to audit.",
          "Run the audit and review the results.",
        ]}
      />
      <div className="tab-strip" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "legacy-comparison"}
          className={tab === "legacy-comparison" ? "active" : ""}
          onClick={() => setTab("legacy-comparison")}
        >
          Legacy comparison
        </button>
        {isAdmin && (
          <button
            role="tab"
            aria-selected={tab === "activity-log"}
            className={tab === "activity-log" ? "active" : ""}
            onClick={() => setTab("activity-log")}
          >
            Activity log
          </button>
        )}
      </div>
      {tab === "legacy-comparison" && <LegacyComparisonSection />}
      {tab === "activity-log" && isAdmin && <ActivityLogSection />}
    </div>
  );
}
