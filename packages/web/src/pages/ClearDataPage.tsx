import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trash2, CheckCircle2, AlertTriangle } from "lucide-react";
import { api, ApiRequestError, type ClearDataCounts, type ClearDataResult, type ClearDataScope, type DataStats } from "../api";
import { InstructionsCard } from "../components/InstructionsCard";
import { ErrorBanner } from "../components/ErrorBanner";
import { formatBytes } from "../lib/format";
import { useAuth } from "../AuthContext";

const CONFIRM_PHRASE = "DELETE";

function totalCount(counts: ClearDataCounts): number {
  return (
    counts.runs +
    counts.batches +
    counts.reconciliationRows +
    counts.decisions +
    counts.legacyComparisons +
    counts.postImportVerifications +
    counts.files +
    counts.activityLogEntries
  );
}

function CountsSummary({ counts }: { counts: ClearDataCounts }) {
  return (
    <div className="grid cols-4">
      <div className="stat">
        <div className="value">{counts.runs}</div>
        <div className="label">Runs</div>
      </div>
      <div className="stat">
        <div className="value">{counts.batches}</div>
        <div className="label">Batches</div>
      </div>
      <div className="stat">
        <div className="value">{counts.reconciliationRows}</div>
        <div className="label">Reconciliation rows</div>
      </div>
      <div className="stat">
        <div className="value">{counts.decisions}</div>
        <div className="label">Decisions</div>
      </div>
      <div className="stat">
        <div className="value">{counts.legacyComparisons}</div>
        <div className="label">Legacy comparisons</div>
      </div>
      <div className="stat">
        <div className="value">{counts.postImportVerifications}</div>
        <div className="label">Post-import verifications</div>
      </div>
      <div className="stat">
        <div className="value">{counts.files}</div>
        <div className="label">Files</div>
      </div>
      <div className="stat">
        <div className="value">{formatBytes(counts.totalFileBytes)}</div>
        <div className="label">Disk space freed</div>
      </div>
      <div className="stat">
        <div className="value">{counts.activityLogEntries}</div>
        <div className="label">Activity log entries</div>
      </div>
    </div>
  );
}

function AlertThresholdEditor({ stats, onSaved }: { stats: DataStats | null; onSaved: (stats: DataStats) => void }) {
  const [rows, setRows] = useState("");
  const [megabytes, setMegabytes] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Only sync on the initial load -- once the user has a value in the
    // field, a later stats refresh (e.g. after Save, or the parent page's
    // own async fetch resolving after they've already started typing)
    // must not silently overwrite what they're editing.
    if (!stats || rows !== "") return;
    setRows(String(stats.thresholds.reconciliationRows));
    setMegabytes(String(Math.round(stats.thresholds.totalFileBytes / (1024 * 1024))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats]);

  async function save() {
    const reconciliationRows = Number(rows);
    const totalFileBytes = Number(megabytes) * 1024 * 1024;
    if (!Number.isFinite(reconciliationRows) || reconciliationRows <= 0 || !Number.isFinite(totalFileBytes) || totalFileBytes <= 0) {
      setError("Both values must be positive numbers.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await api.setDataSizeAlertThresholds({ reconciliationRows, totalFileBytes });
      onSaved(updated);
      setMessage("Saved.");
    } catch (err) {
      console.error(err);
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to save threshold.");
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    setResetting(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await api.resetDataSizeAlertThresholds();
      onSaved(updated);
      // An explicit reset should always overwrite whatever is in the fields,
      // unlike the initial-load sync above.
      setRows(String(updated.thresholds.reconciliationRows));
      setMegabytes(String(Math.round(updated.thresholds.totalFileBytes / (1024 * 1024))));
      setMessage("Reset to default.");
    } catch (err) {
      console.error(err);
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to reset threshold.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="card">
      <h3>Storage alert threshold</h3>
      <p style={{ fontSize: 13, color: "var(--muted)" }}>
        Once either number below is reached, every signed-in user sees a dismissible-per-visit warning banner at the
        top of every page, pointing admins here to clear old data. Currently:{" "}
        {stats ? `${stats.reconciliationRows.toLocaleString()} rows, ${formatBytes(stats.totalFileBytes)} of files` : "loading..."}
        . Lowering a value below the current count is a quick way to preview that banner.
      </p>
      {error && <ErrorBanner message={error} />}
      <div className="toolbar">
        <label>
          Reconciliation rows:{" "}
          <input type="number" min={1} value={rows} onChange={(e) => setRows(e.target.value)} style={{ width: 120 }} />
        </label>
        <label style={{ marginLeft: 16 }}>
          Total file size (MB):{" "}
          <input type="number" min={1} value={megabytes} onChange={(e) => setMegabytes(e.target.value)} style={{ width: 120 }} />
        </label>
        <button onClick={save} disabled={saving || resetting} style={{ marginLeft: 16 }}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button onClick={resetToDefault} disabled={saving || resetting} style={{ marginLeft: 8 }} title="Reset to 250,000 rows / 500 MB">
          {resetting ? "Resetting..." : "Reset to default"}
        </button>
        {message && <span style={{ marginLeft: 12, fontSize: 13, color: "var(--muted)" }}>{message}</span>}
      </div>
    </div>
  );
}

export default function ClearDataPage() {
  const { user } = useAuth();
  const [mode, setMode] = useState<"all" | "select">("all");
  const [includeRunHistory, setIncludeRunHistory] = useState(false);
  const [runHistoryBeforeDate, setRunHistoryBeforeDate] = useState("");
  const [includeCatalog, setIncludeCatalog] = useState(false);
  const [includeActivityLog, setIncludeActivityLog] = useState(false);
  const [preview, setPreview] = useState<ClearDataCounts | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClearDataResult | null>(null);
  const [stats, setStats] = useState<DataStats | null>(null);

  useEffect(() => {
    api.getDataStats().then(setStats);
  }, []);

  // "Clear all" always includes Run History (every run, no date filter) and
  // Catalog -- but deliberately never Activity Log, since that's the app's
  // own record of who cleared what; reaching it requires switching to
  // "Choose what to clear" and checking it explicitly.
  const scope: ClearDataScope =
    mode === "all"
      ? { runHistory: true, runHistoryBeforeDate: null, catalog: true, activityLog: false }
      : {
          runHistory: includeRunHistory,
          runHistoryBeforeDate: includeRunHistory && runHistoryBeforeDate ? new Date(runHistoryBeforeDate).toISOString() : null,
          catalog: includeCatalog,
          activityLog: includeActivityLog,
        };
  const readyToPreview = mode === "all" || includeRunHistory || includeCatalog || includeActivityLog;

  useEffect(() => {
    setPreview(null);
    setResult(null);
    setError(null);
    setConfirmText("");
    if (!readyToPreview) return;
    api
      .previewClearData(scope)
      .then(setPreview)
      .catch((err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to load preview."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, includeRunHistory, runHistoryBeforeDate, includeCatalog, includeActivityLog]);

  async function runClear() {
    setBusy(true);
    setError(null);
    try {
      const cleared = await api.clearData(scope);
      setResult(cleared);
      setPreview(null);
      setConfirmText("");
      api.getDataStats().then(setStats);
    } catch (err) {
      console.error(err);
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to clear data.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Trash2 size={24} strokeWidth={2.25} /> Clear Data
      </h2>
      <InstructionsCard
        pageKey="clear-data"
        description="Permanently deletes data you choose below -- run history, Miva catalog snapshots, and/or the activity log -- along with any files that become orphaned as a result. Users and vendor configuration are never touched. This cannot be undone."
        steps={[
          "Choose Clear all (run history + catalog, never the activity log) or Choose what to clear to pick categories individually.",
          "Review the preview of exactly what will be deleted.",
          "Type DELETE to confirm -- this cannot be undone.",
        ]}
      />
      <div className="card">
        <Link to="/settings">Back to settings</Link>
      </div>

      <div className="card">
        <h3>What to clear</h3>
        <div className="filters">
          <label>
            <input type="radio" checked={mode === "all"} onChange={() => setMode("all")} />{" "}
            <span style={{ color: "var(--red)", fontWeight: 600 }}>Clear all</span> (run history + Miva catalog --
            start over as if newly installed; never touches the activity log)
          </label>
        </div>
        <div className="filters" style={{ marginTop: 8 }}>
          <label>
            <input type="radio" checked={mode === "select"} onChange={() => setMode("select")} /> Choose what to clear
          </label>
        </div>

        {mode === "select" && (
          <div style={{ marginTop: 12, paddingLeft: 24, display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={includeRunHistory}
                  onChange={(e) => setIncludeRunHistory(e.target.checked)}
                />{" "}
                Run History -- runs, batches, reconciliation reviews, decisions, legacy comparisons, post-import
                verifications
              </label>
              {includeRunHistory && (
                <div style={{ marginTop: 6, marginLeft: 22, fontSize: 13 }}>
                  <label>
                    Only runs created before:{" "}
                    <input
                      type="date"
                      value={runHistoryBeforeDate}
                      onChange={(e) => setRunHistoryBeforeDate(e.target.value)}
                    />
                  </label>
                  <span style={{ color: "var(--muted)", marginLeft: 8 }}>(leave blank to clear every run)</span>
                </div>
              )}
            </div>
            <label>
              <input type="checkbox" checked={includeCatalog} onChange={(e) => setIncludeCatalog(e.target.checked)} />{" "}
              Miva Catalog -- pulled/uploaded catalog snapshot files, including ones never used to start a run (only
              ones not still referenced by a run you're keeping)
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeActivityLog}
                onChange={(e) => setIncludeActivityLog(e.target.checked)}
              />{" "}
              <span style={{ color: "var(--red)", fontWeight: 600 }}>Activity Log</span>
              <span style={{ color: "var(--muted)" }}>
                {" "}
                -- permanently erases the audit trail of who did what, including every past Clear Data run. This
                action itself is always re-logged as the first new entry afterward.
              </span>
            </label>
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      {result && (
        <div className="card">
          <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CheckCircle2 size={16} /> Cleared
          </h3>
          <CountsSummary counts={result} />
        </div>
      )}

      {!result && preview && (
        <div className="card">
          <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={16} /> This will delete
          </h3>
          {totalCount(preview) === 0 ? (
            <p>Nothing matches this scope -- there is nothing to clear.</p>
          ) : (
            <>
              <CountsSummary counts={preview} />
              <p style={{ marginTop: 16 }}>
                Type <strong>{CONFIRM_PHRASE}</strong> below to confirm. This cannot be undone.
              </p>
              <div className="toolbar">
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={CONFIRM_PHRASE}
                  style={{ width: 200 }}
                />
                <button className="danger" onClick={runClear} disabled={busy || confirmText !== CONFIRM_PHRASE}>
                  <Trash2 size={16} /> {busy ? "Clearing..." : "Clear Data"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {user?.role === "admin" && <AlertThresholdEditor stats={stats} onSaved={setStats} />}
    </div>
  );
}
