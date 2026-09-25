import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { CheckCheck, Check, X, FileOutput, Download, Search, Undo2, ChevronDown, ArrowUp, ArrowDown } from "lucide-react";
import {
  api,
  type RunRecord,
  type RunSummary,
  type ReviewRowView,
  type ManagedValuesView,
  type BatchRecord,
  type VendorSummary,
} from "../api";
import { InstructionsCard } from "../components/InstructionsCard";
import { ErrorBanner } from "../components/ErrorBanner";
import { importStatusPillClass, runStatusPillClass, IMPORT_STATUS_TOOLTIPS, RUN_STATUS_TOOLTIPS } from "../lib/format";
import { friendlyError } from "../lib/errors";

const REVIEW_CLASS_FILTERS = ["CLEAN", "WARNING", "BLOCKED", "UNCHANGED"];
const DECISION_FILTERS = ["PENDING", "APPROVED", "APPROVED_WARNING_ACK", "REJECTED"];

/** Mirrors packages/shared/src/reports.ts's VENDOR_EXCEPTION_CATEGORIES keys/labels -- kept in sync by hand since the label text (plain language, not code names) belongs in the UI layer, not the shared row-shaping logic. */
const VENDOR_EXCEPTION_CATEGORY_LABELS: Record<string, string> = {
  DUPLICATE_IDENTIFIER: "Duplicate UPC/SKU in vendor file",
  MISSING_OR_INVALID_IDENTIFIER: "Missing or invalid identifier",
  MISSING_OR_INVALID_QUANTITY: "Missing or invalid quantity",
  MISSING_FROM_VENDOR_FILE: "Missing from vendor file (NLA candidates)",
  DATA_WARNINGS: "Data warnings (mismatched totals, date conflicts)",
  UNMATCHED_IN_MIVA: "Unmatched -- UPC not found in Miva",
};
const VENDOR_EXCEPTION_DEFAULT_CATEGORIES = [
  "DUPLICATE_IDENTIFIER",
  "MISSING_OR_INVALID_IDENTIFIER",
  "MISSING_OR_INVALID_QUANTITY",
  "MISSING_FROM_VENDOR_FILE",
  "DATA_WARNINGS",
];

/** ruleId is always "<vendorKey>-inventory-v1" (see runPipeline.ts's ruleIdFor) -- strips that fixed suffix to recover the vendorKey for a vendor label lookup. Duplicated from RunHistoryPage.tsx's identical helper since it's a one-liner and pulling in a shared module for it isn't worth the indirection. */
function vendorKeyFromRuleId(ruleId: string): string {
  return ruleId.replace(/-inventory-v1$/, "");
}

function pillClass(value: string): string {
  return value.toLowerCase().replace("approved_warning_ack", "approved");
}

interface ColumnDef {
  key: string;
  label: string;
  get: (v: ReviewRowView) => string;
  title?: string;
}

const CLASS_TOOLTIP =
  "CLEAN: no issues, can be approved directly. WARNING: unusual data -- review before approving. BLOCKED: has a data problem and can't be approved (see Warnings/Blockers) -- contact an admin. UNCHANGED: nothing to update, no action needed.";

/** Friendly label for a row's matchOutcome, matching the wording already used by the filter checkboxes/stat tiles above the table -- the raw "MISSING - REVIEW REQUIRED" enum string never appears to the user. */
const MATCH_OUTCOME_LABELS: Record<string, string> = {
  MATCHED: "Matched",
  "MISSING - REVIEW REQUIRED": "NLA (Miva only)",
};

const BASE_COLUMNS: ColumnDef[] = [
  { key: "productCode", label: "Product code", get: (v) => v.row.productCode ?? "" },
  { key: "itemNo", label: "Item No", get: (v) => v.row.itemNo ?? "" },
  { key: "upc", label: "UPC / SKU", get: (v) => v.row.rawUpc ?? "" },
  {
    key: "outcome",
    label: "Outcome",
    get: (v) => MATCH_OUTCOME_LABELS[v.row.matchOutcome] ?? v.row.matchOutcome,
    title:
      "Matched: present in both the vendor file and Miva. NLA (Miva only): a Miva product not referenced by any vendor file row this run (NLA candidate).",
  },
  { key: "class", label: "Class", get: (v) => v.row.reviewClass, title: CLASS_TOOLTIP },
  { key: "warnings", label: "Warnings/Blockers", get: (v) => [...v.row.warningCodes, ...v.row.blockerCodes].join(", ") },
  { key: "qty", label: "Qty", get: (v) => v.row.totalQtyRaw ?? "" },
  { key: "currentStatus", label: "Current status", get: (v) => v.row.current.simpleInventory ?? "" },
  { key: "proposedStatus", label: "Proposed status", get: (v) => v.row.proposed.simpleInventory ?? "" },
  { key: "proposedRestock", label: "Proposed restock", get: (v) => v.row.proposed.restockMessage ?? "" },
  { key: "decision", label: "Decision", get: (v) => v.decision.status },
];

/** All six fields the rule engine actually manages -- the review table only ever shows simpleInventory ("status") and restockMessage by default; the other four (availability/dataFeed/shoppingFeed/reportFlag) can differ and drive "changed" without appearing in those two columns at all. */
const MANAGED_FIELD_LABELS: Record<string, string> = {
  simpleInventory: "Status",
  availability: "Availability",
  restockMessage: "Restock",
  dataFeed: "Datafeed",
  shoppingFeed: "Shopping feed",
  reportFlag: "Report flag",
};

const CHANGED_FIELDS_TOOLTIP =
  "Miva product fields this rule manages, beyond Status/Restock (shown as their own columns above): Availability, Datafeed, Shopping feed, and Report flag. See Miva's own product settings for what each controls.";

function diffFields(current: ManagedValuesView, proposed: ManagedValuesView): string[] {
  return Object.keys(MANAGED_FIELD_LABELS).filter((field) => {
    const key = field as keyof ManagedValuesView;
    return (current[key] ?? "").trim() !== (proposed[key] ?? "").trim();
  });
}

const CHANGED_FIELDS_COLUMN: ColumnDef = {
  key: "changedFields",
  label: "Changed fields",
  title: CHANGED_FIELDS_TOOLTIP,
  get: (v) => diffFields(v.row.current, v.row.proposed)
    .map((f) => MANAGED_FIELD_LABELS[f])
    .join(", "),
};

export default function RunReviewPage() {
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<RunRecord | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [runBatches, setRunBatches] = useState<BatchRecord[]>([]);
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [rows, setRows] = useState<ReviewRowView[]>([]);
  const [reviewClassFilter, setReviewClassFilter] = useState<string[]>([]);
  const [decisionFilter, setDecisionFilter] = useState<string[]>([]);
  const [matchOutcomeFilter, setMatchOutcomeFilter] = useState<string[]>([]);
  const [changedOnly, setChangedOnly] = useState(true);
  const [highlightDiff, setHighlightDiff] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [columnFilterValues, setColumnFilterValues] = useState<Record<string, Set<string>>>({});
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null);
  const [popoverSearch, setPopoverSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [vendorReportMenuOpen, setVendorReportMenuOpen] = useState(false);
  const [vendorReportCategories, setVendorReportCategories] = useState<string[]>(VENDOR_EXCEPTION_DEFAULT_CATEGORIES);
  const [vendorReportFormat, setVendorReportFormat] = useState<"csv" | "xlsx">("xlsx");

  // Fills the rest of the viewport below the table instead of a fixed
  // maxHeight, so it adapts to the monitor size and to whatever's above it
  // changing height -- same technique as Run History's tables, the Miva
  // Catalog table, and the Activity Log table.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tableHeight, setTableHeight] = useState(400);

  useEffect(() => {
    const el = scrollRef.current;
    // Before `run` loads, the component returns its "Loading..." fallback
    // below, so `el` isn't attached yet on that first pass -- re-running
    // this effect once run/summary/runBatches arrive (any of which change
    // the content above the table) re-attaches it and recomputes against
    // the real layout, instead of leaving tableHeight stuck at its initial
    // default forever.
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
  }, [run, summary, runBatches, highlightDiff]);

  const columns = useMemo(() => {
    if (!highlightDiff) return BASE_COLUMNS;
    const withChangedFields = [...BASE_COLUMNS];
    withChangedFields.splice(withChangedFields.findIndex((c) => c.key === "decision"), 0, CHANGED_FIELDS_COLUMN);
    return withChangedFields;
  }, [highlightDiff]);

  const loadRun = useCallback(async () => {
    if (!runId) return;
    const { run, summary } = await api.getRun(runId);
    setRun(run);
    setSummary(summary);
  }, [runId]);

  const loadRunBatches = useCallback(async () => {
    if (!runId) return;
    setRunBatches(await api.listRunBatches(runId));
  }, [runId]);

  useEffect(() => {
    loadRunBatches();
  }, [loadRunBatches]);

  useEffect(() => {
    api.listVendorSummaries().then(setVendors);
  }, []);

  const loadRows = useCallback(async () => {
    if (!runId) return;
    const params: Record<string, string> = {};
    if (reviewClassFilter.length) params.reviewClass = reviewClassFilter.join(",");
    if (decisionFilter.length) params.decisionStatus = decisionFilter.join(",");
    if (matchOutcomeFilter.length) params.matchOutcome = matchOutcomeFilter.join(",");
    if (changedOnly) params.changed = "true";
    if (search) params.search = search;
    const data = await api.getRunRows(runId, params);
    setRows(data);
  }, [runId, reviewClassFilter, decisionFilter, matchOutcomeFilter, changedOnly, search]);

  useEffect(() => {
    loadRun();
  }, [loadRun]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  function toggleFilter(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function vendorLabelForRuleId(ruleId: string): string {
    const vendorKey = vendorKeyFromRuleId(ruleId);
    return vendors.find((v) => v.vendorKey === vendorKey)?.vendorLabel ?? vendorKey;
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  const hasColumnFilters = Object.keys(columnFilterValues).length > 0;

  function clearColumnFiltersAndSort() {
    setColumnFilterValues({});
    setSortKey(null);
    setSortDir("asc");
  }

  function displayValue(raw: string): string {
    return raw === "" ? "(Blank)" : raw;
  }

  // Distinct values available per column, computed from the server-filtered
  // row set (not from other columns' active filters) -- like Excel's
  // AutoFilter dropdown listing every value that occurs in the column.
  const distinctValuesByColumn = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of columns) {
      const set = new Set<string>();
      for (const r of rows) set.add(displayValue(col.get(r)));
      map[col.key] = Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    return map;
  }, [rows, columns]);

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

  useEffect(() => {
    if (!openFilterColumn) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".col-filter-wrap")) setOpenFilterColumn(null);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openFilterColumn]);

  useEffect(() => {
    if (!vendorReportMenuOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".vendor-report-menu-wrap")) setVendorReportMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [vendorReportMenuOpen]);

  const displayedRows = useMemo(() => {
    let result = rows;
    for (const col of columns) {
      const allowed = columnFilterValues[col.key];
      if (allowed) result = result.filter((v) => allowed.has(displayValue(col.get(v))));
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
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
  }, [rows, columnFilterValues, sortKey, sortDir, columns]);

  const selectableRowIds = useMemo(
    () => displayedRows.filter(({ row, decision }) => row.reviewClass === "CLEAN" && !decision.locked).map(({ row }) => row.id),
    [displayedRows],
  );
  const allSelectableSelected = selectableRowIds.length > 0 && selectableRowIds.every((id) => selected.has(id));

  function toggleSelectAllRows() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectableSelected) {
        selectableRowIds.forEach((id) => next.delete(id));
      } else {
        selectableRowIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(friendlyError(err, "Action failed."));
    } finally {
      setBusy(false);
    }
  }

  async function approveAllClean() {
    if (!window.confirm("Approve every clean, changed row in this run? This can be undone per-row until you generate a batch.")) return;
    await withBusy(async () => {
      await api.approveAllClean(runId!);
      await Promise.all([loadRun(), loadRows()]);
    });
  }

  async function bulkAction(decision: "APPROVED" | "REJECTED") {
    const verb = decision === "APPROVED" ? "Approve" : "Reject";
    if (!window.confirm(`${verb} the ${selected.size} selected row${selected.size === 1 ? "" : "s"}? This can be undone per-row until you generate a batch.`)) return;
    await withBusy(async () => {
      await api.bulkDecision(runId!, [...selected], decision);
      setSelected(new Set());
      await Promise.all([loadRun(), loadRows()]);
    });
  }

  async function singleDecision(rowId: string, decision: string) {
    await withBusy(async () => {
      await api.setDecision(runId!, rowId, decision);
      await Promise.all([loadRun(), loadRows()]);
    });
  }

  async function generateBatch() {
    if (
      !window.confirm(
        "Generate a batch from all currently-approved rows? Once generated, those rows' decisions can't be changed. Rows still pending won't be included.",
      )
    )
      return;
    await withBusy(async () => {
      const batch = await api.generateBatch(runId!);
      window.location.href = `/batches/${batch.id}`;
    });
  }

  function toggleVendorReportCategory(key: string) {
    setVendorReportCategories((prev) => (prev.includes(key) ? prev.filter((v) => v !== key) : [...prev, key]));
  }

  async function exportVendorExceptionReport() {
    setVendorReportMenuOpen(false);
    await withBusy(async () => {
      const file = await api.generateVendorExceptionReport(runId!, vendorReportCategories, vendorReportFormat);
      window.location.href = api.downloadFileUrl(file.id);
    });
  }

  if (!run) return <div>Loading...</div>;

  return (
    <div>
      <div style={{ marginBottom: 4, fontSize: 13 }}>
        <Link to="/runs">← Back to run history</Link>
        {" · "}
        <Link
          to={`/audits?runId=${run.id}`}
          title="Read-only sanity check comparing this run's results against the previous manual process. Doesn't change any data."
        >
          Legacy comparison for this run
        </Link>
      </div>
      <h2>Run {run.id.slice(0, 8)}</h2>
      <InstructionsCard
        pageKey="run-review"
        description="Review this run's reconciliation results row by row."
        steps={[
          "Filter and search the rows below to focus on what needs attention.",
          "Approve or reject each row, or approve all clean rows at once.",
          "Generate a batch once you're done reviewing.",
        ]}
      />
      <div className="card">
        <div className="grid cols-5">
          <div>
            <strong>Status:</strong>{" "}
            <span className={`pill ${runStatusPillClass(run.status)}`} title={RUN_STATUS_TOOLTIPS[run.status]}>
              {run.status}
            </span>
          </div>
          <div>
            <strong>Vendor:</strong> {vendorLabelForRuleId(run.ruleId)}
          </div>
          <div title="Internal identifier for the exact rule version used to produce this run -- only relevant for debugging, safe to ignore day to day.">
            <strong>Rule:</strong> {run.ruleId}
          </div>
          <div title={`Internal config version identifier -- only relevant for debugging, safe to ignore day to day. Full hash: ${run.ruleConfigHash}`}>
            <strong>Config hash:</strong> {run.ruleConfigHash.slice(0, 12)}...
          </div>
          <div>
            <strong>Run date:</strong> {run.runDate}
          </div>
        </div>
        {run.status === "failed" && <ErrorBanner message={`Run failed: ${run.failureReason}`} />}
      </div>

      {runBatches.length > 0 && (
        <div className="card">
          <h3>Batches</h3>
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Batch ID</th>
                <th>Import status</th>
              </tr>
            </thead>
            <tbody>
              {runBatches.map((b) => (
                <tr key={b.id}>
                  <td>{new Date(b.createdAt).toLocaleString()}</td>
                  <td title={b.id}>
                    <Link to={`/batches/${b.id}`}>{b.id.slice(0, 8)}</Link>
                  </td>
                  <td>
                    <span className={`pill ${importStatusPillClass(b.importStatus)}`} title={IMPORT_STATUS_TOOLTIPS[b.importStatus]}>
                      {b.importStatus}
                    </span>
                    {b.rolledBackAt && (
                      <span
                        title={`Rolled back ${new Date(b.rolledBackAt).toLocaleString()}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          marginLeft: 6,
                          fontSize: 12,
                          color: "var(--muted)",
                        }}
                      >
                        <Undo2 size={12} /> rolled back
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      {summary && (
        <div className="card">
          <h3>Summary</h3>
          <div className="grid cols-10">
            <div className="stat">
              <div className="value">{summary.total}</div>
              <div className="label">Total rows</div>
            </div>
            <div className="stat" title="Vendor rows whose UPC/SKU resolved to exactly one Miva product (matchOutcome MATCHED) -- present in both the vendor file and Miva.">
              <div className="value">{summary.byMatchOutcome?.MATCHED ?? 0}</div>
              <div className="label">Matched</div>
            </div>
            <div
              className="stat"
              title="Miva products not referenced by any vendor file row this run (matchOutcome MISSING - REVIEW REQUIRED) -- NLA candidates, not in the vendor file at all."
            >
              <div className="value">{summary.byMatchOutcome?.["MISSING - REVIEW REQUIRED"] ?? 0}</div>
              <div className="label">NLA (Miva only)</div>
            </div>
            <div className="stat">
              <div className="value">{summary.changed}</div>
              <div className="label">Changed</div>
            </div>
            <div className="stat">
              <div className="value">{summary.byReviewClass?.CLEAN ?? 0}</div>
              <div className="label">Clean</div>
            </div>
            <div className="stat">
              <div className="value">{summary.byReviewClass?.WARNING ?? 0}</div>
              <div className="label">Warning</div>
            </div>
            <div className="stat">
              <div className="value">{summary.byReviewClass?.BLOCKED ?? 0}</div>
              <div className="label">Blocked</div>
            </div>
            <div className="stat">
              <div className="value">{summary.byReviewClass?.UNCHANGED ?? 0}</div>
              <div className="label">Unchanged</div>
            </div>
            <div className="stat">
              <div className="value">{summary.byDecisionStatus?.APPROVED ?? 0}</div>
              <div className="label">Approved</div>
            </div>
            <div className="stat">
              <div className="value">{summary.byDecisionStatus?.APPROVED_WARNING_ACK ?? 0}</div>
              <div className="label">Approved (ack)</div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="toolbar">
          <button className="primary" onClick={approveAllClean} disabled={busy}>
            <CheckCheck size={16} /> Approve all clean
          </button>
          <button className="success" onClick={() => bulkAction("APPROVED")} disabled={busy || selected.size === 0}>
            <Check size={16} /> Approve selected clean rows
          </button>
          <button className="danger" onClick={() => bulkAction("REJECTED")} disabled={busy || selected.size === 0}>
            <X size={16} /> Reject selected
          </button>
          <button className="primary" onClick={generateBatch} disabled={busy}>
            <FileOutput size={16} /> Generate batch
          </button>
          <div className="vendor-report-menu-wrap" style={{ position: "relative" }}>
            <button
              onClick={() => setVendorReportMenuOpen((v) => !v)}
              disabled={busy}
              title="Generates a file listing problems found in the vendor's file (duplicates, missing data, etc.) that you can send back to the vendor so they can fix it."
            >
              <Download size={16} /> Export vendor exception report
            </button>
            {vendorReportMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  background: "white",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                  padding: 10,
                  width: 300,
                  zIndex: 20,
                }}
              >
                <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
                  A report for the vendor, listing problems in their file so they can fix it for next time. Choose
                  which categories to include -- unmatched-in-Miva is huge and usually not a vendor error, so it's
                  off by default.
                </p>
                {Object.entries(VENDOR_EXCEPTION_CATEGORY_LABELS).map(([key, label]) => (
                  <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "3px 0" }}>
                    <input
                      type="checkbox"
                      checked={vendorReportCategories.includes(key)}
                      onChange={() => toggleVendorReportCategory(key)}
                    />
                    {label}
                  </label>
                ))}
                <div style={{ display: "flex", gap: 12, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <input
                      type="radio"
                      name="vendorReportFormat"
                      checked={vendorReportFormat === "xlsx"}
                      onChange={() => setVendorReportFormat("xlsx")}
                    />
                    Excel (.xlsx)
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <input
                      type="radio"
                      name="vendorReportFormat"
                      checked={vendorReportFormat === "csv"}
                      onChange={() => setVendorReportFormat("csv")}
                    />
                    CSV
                  </label>
                </div>
                <button
                  className="primary"
                  style={{ marginTop: 8, width: "100%" }}
                  onClick={exportVendorExceptionReport}
                  disabled={busy || vendorReportCategories.length === 0}
                >
                  Export {vendorReportFormat === "xlsx" ? "Excel" : "CSV"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="filters">
          <span style={{ fontWeight: 700 }}>Review class:</span>
          {REVIEW_CLASS_FILTERS.map((c) => (
            <label key={c}>
              <input
                type="checkbox"
                checked={reviewClassFilter.includes(c)}
                onChange={() => toggleFilter(reviewClassFilter, setReviewClassFilter, c)}
              />{" "}
              {c}
            </label>
          ))}
          <span style={{ marginLeft: 16, fontWeight: 700 }}>Decision:</span>
          {DECISION_FILTERS.map((c) => (
            <label key={c}>
              <input
                type="checkbox"
                checked={decisionFilter.includes(c)}
                onChange={() => toggleFilter(decisionFilter, setDecisionFilter, c)}
              />{" "}
              {c}
            </label>
          ))}
          <label style={{ marginLeft: 16 }}>
            <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} /> Changed only
          </label>
          <span style={{ marginLeft: 16, fontWeight: 700 }}>Match:</span>
          <label title="Rows whose UPC/SKU resolved to exactly one Miva product (matchOutcome MATCHED) -- present in both the vendor file and Miva.">
            <input
              type="checkbox"
              checked={matchOutcomeFilter.includes("MATCHED")}
              onChange={() => toggleFilter(matchOutcomeFilter, setMatchOutcomeFilter, "MATCHED")}
            />{" "}
            Matched
          </label>
          <label title="Miva products not referenced by any vendor file row this run (matchOutcome MISSING - REVIEW REQUIRED) -- NLA candidates, not in the vendor file at all.">
            <input
              type="checkbox"
              checked={matchOutcomeFilter.includes("MISSING - REVIEW REQUIRED")}
              onChange={() => toggleFilter(matchOutcomeFilter, setMatchOutcomeFilter, "MISSING - REVIEW REQUIRED")}
            />{" "}
            NLA (Miva only)
          </label>
          <label style={{ marginLeft: 16 }} title="Adds a 'Changed fields' column listing which of the six managed fields actually differ -- Current/Proposed status only shows one of them.">
            <input type="checkbox" checked={highlightDiff} onChange={(e) => setHighlightDiff(e.target.checked)} /> Highlight differences
          </label>
          <div className="search-input" style={{ marginLeft: 16 }}>
            <Search size={14} />
            <input
              type="text"
              placeholder="Search item / UPC / product code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span style={{ marginLeft: "auto", color: "var(--muted)", whiteSpace: "nowrap" }}>
            Showing {displayedRows.length} of {rows.length} row{rows.length === 1 ? "" : "s"}
            {selected.size > 0 && ` · ${selected.size} selected`}
            {(hasColumnFilters || sortKey) && (
              <>
                {" "}
                ·{" "}
                <button style={{ padding: "2px 8px" }} onClick={clearColumnFiltersAndSort}>
                  Clear column filters/sort
                </button>
              </>
            )}
          </span>
        </div>

        <div className="table-scroll" ref={scrollRef} style={{ height: tableHeight, maxHeight: tableHeight }}>
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allSelectableSelected}
                    onChange={toggleSelectAllRows}
                    disabled={selectableRowIds.length === 0}
                    title="Select all clean, unlocked rows currently shown"
                  />
                </th>
                {columns.map((col) => {
                  const active = Boolean(columnFilterValues[col.key]);
                  const allValues = distinctValuesByColumn[col.key] ?? [];
                  const selectedSet = effectiveSelectedFor(col.key);
                  const visibleValues = popoverSearch
                    ? allValues.filter((v) => v.toLowerCase().includes(popoverSearch.toLowerCase()))
                    : allValues;
                  return (
                    <th key={col.key} style={{ zIndex: 2 }}>
                      <div className="col-filter-wrap" style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
                        <span
                          onClick={() => toggleSort(col.key)}
                          title={col.title}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", userSelect: "none" }}
                        >
                          {col.label}
                          {sortKey === col.key && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                        </span>
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
                              {visibleValues.map((val) => (
                                <label key={val} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "2px 0" }}>
                                  <input
                                    type="checkbox"
                                    checked={selectedSet.has(val)}
                                    onChange={() => toggleValue(col.key, val)}
                                  />
                                  {val}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </th>
                  );
                })}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedRows.map(({ row, decision }) => {
                const changedFieldsForRow = highlightDiff ? diffFields(row.current, row.proposed) : [];
                const highlightStyle = { background: "var(--amber-soft)" };
                return (
                <tr key={row.id}>
                  <td>
                    {row.reviewClass === "CLEAN" && !decision.locked && (
                      <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} />
                    )}
                  </td>
                  <td>{row.productCode ?? "-"}</td>
                  <td>{row.itemNo ?? "-"}</td>
                  <td>{row.rawUpc ?? "-"}</td>
                  <td title="Matched: present in both the vendor file and Miva. NLA (Miva only): a Miva product not referenced by any vendor file row this run.">
                    {MATCH_OUTCOME_LABELS[row.matchOutcome] ?? row.matchOutcome}
                  </td>
                  <td>
                    <span className={`pill ${pillClass(row.reviewClass)}`} title={CLASS_TOOLTIP}>
                      {row.reviewClass}
                    </span>
                  </td>
                  <td>{[...row.warningCodes, ...row.blockerCodes].join(", ") || "-"}</td>
                  <td>{row.totalQtyRaw ?? "-"}</td>
                  <td>{row.current.simpleInventory ?? "-"}</td>
                  <td style={changedFieldsForRow.includes("simpleInventory") ? highlightStyle : undefined}>
                    {row.proposed.simpleInventory ?? "-"}
                  </td>
                  <td style={changedFieldsForRow.includes("restockMessage") ? highlightStyle : undefined}>
                    {row.proposed.restockMessage ?? "-"}
                  </td>
                  {highlightDiff && (
                    <td title={CHANGED_FIELDS_TOOLTIP}>{changedFieldsForRow.map((f) => MANAGED_FIELD_LABELS[f]).join(", ") || "-"}</td>
                  )}
                  <td>
                    <span className={`pill ${pillClass(decision.status)}`}>{decision.status}</span>
                    {decision.locked && (
                      <span title="Locked because this row is already part of a generated batch and can no longer be changed."> (frozen)</span>
                    )}
                  </td>
                  <td>
                    {!decision.locked && row.reviewClass === "CLEAN" && (
                      <>
                        <button className="success-soft" onClick={() => singleDecision(row.id, "APPROVED")} disabled={busy}>
                          Approve
                        </button>{" "}
                        <button className="danger-soft" onClick={() => singleDecision(row.id, "REJECTED")} disabled={busy}>
                          Reject
                        </button>
                      </>
                    )}
                    {!decision.locked && row.reviewClass === "WARNING" && (
                      <>
                        <button className="success-soft" onClick={() => singleDecision(row.id, "APPROVED_WARNING_ACK")} disabled={busy}>
                          Acknowledge &amp; approve
                        </button>{" "}
                        <button className="danger-soft" onClick={() => singleDecision(row.id, "REJECTED")} disabled={busy}>
                          Reject
                        </button>
                      </>
                    )}
                    {!decision.locked && decision.status !== "PENDING" && (
                      <>
                        {" "}
                        <button onClick={() => singleDecision(row.id, "PENDING")} disabled={busy}>
                          Reset to pending
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
