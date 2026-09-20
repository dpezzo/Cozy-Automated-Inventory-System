import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type AuditLogRecord, type FileRecord, type RunRecord } from "../api";
import { UploadBox } from "../components/UploadBox";
import { StepHeader } from "../components/StepBadge";
import { InstructionsCard } from "../components/InstructionsCard";
import { useAuth } from "../AuthContext";

function LegacyComparisonSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [legacyFiles, setLegacyFiles] = useState<FileRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState(searchParams.get("runId") ?? "");
  const [selectedLegacy, setSelectedLegacy] = useState("");
  const [runSearch, setRunSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legacyResult, setLegacyResult] = useState<{ exact: number; approved: number; unexplained: number; notComparable: number } | null>(
    null,
  );

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
    setLegacyResult(null);
    setSearchParams(runId ? { runId } : {});
  }

  async function runLegacy() {
    if (!selectedRun || !selectedLegacy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.runLegacyComparison(selectedRun, selectedLegacy);
      const counts = { exact: 0, approved: 0, unexplained: 0, notComparable: 0 };
      for (const r of result.rows) {
        if (r.comparison_class === "EXACT_MATCH") counts.exact++;
        else if (r.comparison_class === "APPROVED_DEVIATION") counts.approved++;
        else if (r.comparison_class === "UNEXPLAINED_DIFFERENCE") counts.unexplained++;
        else counts.notComparable++;
      }
      setLegacyResult(counts);
    } catch {
      setError("Legacy comparison failed.");
    } finally {
      setBusy(false);
    }
  }

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
