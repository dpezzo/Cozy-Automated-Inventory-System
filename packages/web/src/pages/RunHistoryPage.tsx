import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type RunRecord, type BatchRecord, type VendorSummary } from "../api";
import { InstructionsCard } from "../components/InstructionsCard";
import { importStatusPillClass, runStatusPillClass } from "../lib/format";

/** ruleId is always "<vendorKey>-inventory-v1" (see runPipeline.ts's ruleIdFor) -- strips that fixed suffix to recover the vendorKey for a vendor label lookup. */
function vendorKeyFromRuleId(ruleId: string): string {
  return ruleId.replace(/-inventory-v1$/, "");
}

// Shared pixel widths for the columns the Runs and Batches tables have in
// common (Created/ID/Status/Vendor), so the two independent <table>s -- each
// of which would otherwise size its own columns from its own content -- line
// up at a glance. Used with .aligned-table (table-layout: fixed) below.
const COL_CREATED = 170;
const COL_ID = 100;
/** Wide enough for the longest value from either status domain -- run status ("validating") and importStatus ("API_PUSH_PARTIAL_FAILURE") share this width so the Status/Import status/Batch status/Run status columns all align. */
const COL_STATUS = 200;
const COL_VENDOR = 180;

export default function RunHistoryPage() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.listRuns().then(setRuns);
    api.listBatches().then(setBatches);
    api.listVendorSummaries().then(setVendors);
  }, []);

  const runsById = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs]);

  // Newest-first per run (batches is already ordered newest-first overall --
  // see listAllBatches), so batchesForRun(id)[0] is always the latest batch.
  const batchesByRun = useMemo(() => {
    const map = new Map<string, BatchRecord[]>();
    for (const b of batches) {
      const list = map.get(b.runId);
      if (list) list.push(b);
      else map.set(b.runId, [b]);
    }
    return map;
  }, [batches]);

  function vendorLabelForRuleId(ruleId: string): string {
    const vendorKey = vendorKeyFromRuleId(ruleId);
    return vendors.find((v) => v.vendorKey === vendorKey)?.vendorLabel ?? vendorKey;
  }

  const filtered = runs.filter(
    (r) => r.id.includes(search) || r.ruleId.includes(search) || r.status.includes(search.toLowerCase()),
  );

  // A fixed "calc(100vh - 48px)" assumes this page is the only thing in
  // .main, which breaks whenever something above it (e.g. the global
  // DataSizeAlert, which loads asynchronously and can appear after this
  // page has already mounted) changes height -- the fixed value stops
  // matching what's actually left, and the whole page scrolls again. Measure
  // the real available space instead, and re-measure whenever anything in
  // the page changes size.
  const rootRef = useRef<HTMLDivElement>(null);
  const [pageHeight, setPageHeight] = useState<number | string>("calc(100vh - 48px)");

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    function recompute() {
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setPageHeight(Math.max(300, window.innerHeight - top - 24)); // 24px = .main's own bottom padding
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
    <div ref={rootRef} style={{ display: "flex", flexDirection: "column", height: pageHeight }}>
      <h2>Run History</h2>
      <InstructionsCard
        pageKey="run-history"
        description="A run compares one vendor inventory file against one Miva catalog snapshot and produces rows to review, approve, or reject. A batch is the set of approved, changed rows from a run turned into ready-to-import Miva CSV files -- a single run can produce more than one batch over time, since each time you approve more rows and generate a batch, that becomes a new one. The Runs table below is where reconciliation happens; the Batches table is where you track what's actually been generated and imported."
        steps={[
          "Search by run ID, status, or rule to find a specific run.",
          "Open a run to review its rows, approve or reject changes, and generate a batch.",
          "Open a batch to download its CSVs, push it to Miva, or record the import outcome.",
        ]}
      />
      <div className="filters">
        <input
          type="text"
          placeholder="Search by run ID, status, or rule"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 320 }}
        />
      </div>
      <div className="card" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <h3>Runs</h3>
        <div className="table-scroll" style={{ flex: 1, minHeight: 0 }}>
          <table className="aligned-table">
            <colgroup>
              <col style={{ width: COL_CREATED }} />
              <col style={{ width: COL_ID }} />
              <col style={{ width: COL_STATUS }} />
              <col style={{ width: COL_VENDOR }} />
              <col />
              <col style={{ width: COL_ID }} />
              <col style={{ width: COL_STATUS }} />
            </colgroup>
            <thead>
              <tr>
                <th>Created</th>
                <th>Run ID</th>
                <th>Status</th>
                <th>Vendor</th>
                <th>Rule / hash</th>
                <th>Batch</th>
                <th>Batch status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const runBatches = batchesByRun.get(r.id) ?? [];
                const latestBatch = runBatches[0];
                const moreBatchesTitle =
                  runBatches.length > 1
                    ? `${runBatches.length} batches total for this run, most recent shown`
                    : undefined;
                return (
                  <tr key={r.id}>
                    <td>{new Date(r.createdAt).toLocaleString()}</td>
                    <td title={r.id}>
                      <Link to={`/runs/${r.id}`}>{r.id.slice(0, 8)}</Link>
                    </td>
                    <td>
                      <span className={`pill ${runStatusPillClass(r.status)}`}>{r.status}</span>
                    </td>
                    <td title={vendorLabelForRuleId(r.ruleId)}>{vendorLabelForRuleId(r.ruleId)}</td>
                    <td title={r.ruleConfigHash}>
                      {r.ruleId} / {r.ruleConfigHash.slice(0, 10)}
                    </td>
                    <td title={moreBatchesTitle}>
                      {latestBatch ? (
                        <>
                          <Link to={`/batches/${latestBatch.id}`}>{latestBatch.id.slice(0, 8)}</Link>
                          {runBatches.length > 1 && (
                            <span style={{ marginLeft: 4, fontSize: 12, color: "#64748b" }}>
                              +{runBatches.length - 1}
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{ color: "#94a3b8" }}>Not batched</span>
                      )}
                    </td>
                    <td>
                      {latestBatch && (
                        <>
                          <span className={`pill ${importStatusPillClass(latestBatch.importStatus)}`}>
                            {latestBatch.importStatus}
                          </span>
                          {latestBatch.rolledBackAt && (
                            <span title={`Rolled back ${new Date(latestBatch.rolledBackAt).toLocaleString()}`}>
                              {" "}
                              ↩
                            </span>
                          )}
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

      <div className="card" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <h3>Batches</h3>
        <div className="table-scroll" style={{ flex: 1, minHeight: 0 }}>
          <table className="aligned-table">
            <colgroup>
              <col style={{ width: COL_CREATED }} />
              <col style={{ width: COL_ID }} />
              <col style={{ width: COL_STATUS }} />
              <col style={{ width: COL_VENDOR }} />
              <col style={{ width: COL_ID }} />
              <col style={{ width: COL_STATUS }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>Created</th>
                <th>Batch ID</th>
                <th>Import status</th>
                <th>Vendor</th>
                <th>Run</th>
                <th>Run status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const run = runsById.get(b.runId);
                return (
                  <tr key={b.id}>
                    <td>{new Date(b.createdAt).toLocaleString()}</td>
                    <td title={b.id}>
                      <Link to={`/batches/${b.id}`}>{b.id.slice(0, 8)}</Link>
                    </td>
                    <td>
                      <span className={`pill ${importStatusPillClass(b.importStatus)}`}>{b.importStatus}</span>
                      {b.rolledBackAt && (
                        <span title={`Rolled back ${new Date(b.rolledBackAt).toLocaleString()}`}> ↩</span>
                      )}
                    </td>
                    <td title={run ? vendorLabelForRuleId(run.ruleId) : undefined}>
                      {run ? vendorLabelForRuleId(run.ruleId) : "—"}
                    </td>
                    <td>
                      <Link to={`/runs/${b.runId}`}>{b.runId.slice(0, 8)}</Link>
                    </td>
                    <td>
                      {run && <span className={`pill ${runStatusPillClass(run.status)}`}>{run.status}</span>}
                    </td>
                    <td></td>
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
