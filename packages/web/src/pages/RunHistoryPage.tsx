import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type RunRecord, type BatchRecord, type VendorSummary } from "../api";
import { InstructionsCard } from "../components/InstructionsCard";

/** ruleId is always "<vendorKey>-inventory-v1" (see runPipeline.ts's ruleIdFor) -- strips that fixed suffix to recover the vendorKey for a vendor label lookup. */
function vendorKeyFromRuleId(ruleId: string): string {
  return ruleId.replace(/-inventory-v1$/, "");
}

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
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Run ID</th>
                <th>Status</th>
                <th>Rule / hash</th>
                <th>Run date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td title={r.id}>{r.id.slice(0, 8)}</td>
                  <td>{r.status}</td>
                  <td title={r.ruleConfigHash}>
                    {r.ruleId} / {r.ruleConfigHash.slice(0, 10)}
                  </td>
                  <td>{r.runDate}</td>
                  <td>
                    <Link to={`/runs/${r.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <h3>Batches</h3>
        <div className="table-scroll" style={{ flex: 1, minHeight: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Batch ID</th>
                <th>Vendor</th>
                <th>Run</th>
                <th>Import status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const run = runsById.get(b.runId);
                return (
                  <tr key={b.id}>
                    <td>{new Date(b.createdAt).toLocaleString()}</td>
                    <td title={b.id}>{b.id.slice(0, 8)}</td>
                    <td>{run ? vendorLabelForRuleId(run.ruleId) : "—"}</td>
                    <td>
                      <Link to={`/runs/${b.runId}`}>{b.runId.slice(0, 8)}</Link>
                    </td>
                    <td>{b.importStatus}</td>
                    <td>
                      <Link to={`/batches/${b.id}`}>Open</Link>
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
