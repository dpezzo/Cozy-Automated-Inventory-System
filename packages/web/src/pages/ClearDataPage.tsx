import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trash2, CheckCircle2, AlertTriangle } from "lucide-react";
import { api, ApiRequestError, type ClearDataCounts, type ClearDataResult, type DataStats } from "../api";
import { InstructionsCard } from "../components/InstructionsCard";
import { ErrorBanner } from "../components/ErrorBanner";
import { formatBytes } from "../lib/format";
import { useAuth } from "../AuthContext";

const CONFIRM_PHRASE = "DELETE";

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
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to reset threshold.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="card">
      <h3>Storage alert threshold</h3>
      <p style={{ fontSize: 13, color: "var(--muted)" }}>
        Every signed-in user sees a storage alert once either number below is reached. Currently:{" "}
        {stats ? `${stats.reconciliationRows.toLocaleString()} rows, ${formatBytes(stats.totalFileBytes)} of files` : "loading..."}
        . Lowering a value below the current count is a quick way to preview the alert.
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
  const [mode, setMode] = useState<"all" | "before">("before");
  const [beforeDate, setBeforeDate] = useState("");
  const [preview, setPreview] = useState<ClearDataCounts | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClearDataResult | null>(null);
  const [stats, setStats] = useState<DataStats | null>(null);

  useEffect(() => {
    api.getDataStats().then(setStats);
  }, []);

  const effectiveBeforeDate = mode === "all" ? null : beforeDate ? new Date(beforeDate).toISOString() : null;
  const readyToPreview = mode === "all" || Boolean(beforeDate);

  useEffect(() => {
    setPreview(null);
    setResult(null);
    setError(null);
    setConfirmText("");
    if (!readyToPreview) return;
    api
      .previewClearData(effectiveBeforeDate)
      .then(setPreview)
      .catch((err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to load preview."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, beforeDate]);

  async function runClear() {
    setBusy(true);
    setError(null);
    try {
      const cleared = await api.clearData(effectiveBeforeDate);
      setResult(cleared);
      setPreview(null);
      setConfirmText("");
      api.getDataStats().then(setStats);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to clear data.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Trash2 size={20} /> Clear Data
      </h2>
      <InstructionsCard
        pageKey="clear-data"
        description="Permanently deletes runs and everything generated from them -- reconciliation rows, decisions, batches, legacy comparisons, post-import verifications -- along with the uploaded and generated files that only those runs used. Users, vendor configuration, and the activity log are never touched. This cannot be undone."
        steps={[
          "Choose what to clear: runs older than a date, or everything.",
          "Review the preview of exactly what will be deleted.",
          "Type DELETE to confirm -- this cannot be undone.",
        ]}
      />

      <div className="card">
        <h3>What to clear</h3>
        <div className="filters">
          <label>
            <input type="radio" checked={mode === "before"} onChange={() => setMode("before")} /> Runs created before
            a date
          </label>
          {mode === "before" && (
            <input
              type="date"
              value={beforeDate}
              onChange={(e) => setBeforeDate(e.target.value)}
              style={{ marginLeft: 16 }}
            />
          )}
        </div>
        <div className="filters" style={{ marginTop: 8 }}>
          <label>
            <input type="radio" checked={mode === "all"} onChange={() => setMode("all")} /> Everything (fresh-install
            reset)
          </label>
        </div>
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
          {preview.runs === 0 ? (
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

      <div className="card">
        <Link to="/settings">Back to settings</Link>
      </div>
    </div>
  );
}
