import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, ApiRequestError, type BatchRecord, type FileRecord, type VerificationRow, type PushBatchResult } from "../api";

const IMPORT_STATUSES = ["GENERATED", "DOWNLOADED", "IMPORT_REPORTED", "IMPORT_FAILED"];

export default function BatchDetailPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const [batch, setBatch] = useState<BatchRecord | null>(null);
  const [postImportFiles, setPostImportFiles] = useState<FileRecord[]>([]);
  const [selectedPostImport, setSelectedPostImport] = useState("");
  const [verificationRows, setVerificationRows] = useState<VerificationRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mivaApi, setMivaApi] = useState<{ configured: boolean; environment: "development" | "production" }>({
    configured: false,
    environment: "development",
  });
  const [confirmProduction, setConfirmProduction] = useState(false);
  const [pushResult, setPushResult] = useState<PushBatchResult | null>(null);

  async function load() {
    if (!batchId) return;
    setBatch(await api.getBatch(batchId));
  }

  useEffect(() => {
    load();
    api.listFiles("post_import_snapshot").then(setPostImportFiles);
    api.getMivaApiStatus().then(setMivaApi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  async function pushToMiva() {
    if (!batchId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.pushBatchToMiva(batchId, confirmProduction);
      setPushResult(result);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Push to Miva failed.");
    } finally {
      setBusy(false);
    }
  }

  async function setOutcome(status: string) {
    if (!batchId) return;
    setBusy(true);
    setError(null);
    try {
      await api.setImportOutcome(batchId, status);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to record outcome.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!batchId || !selectedPostImport) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.runPostImportVerification(batchId, selectedPostImport);
      setVerificationRows(result.rows);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!batch) return <div>Loading...</div>;

  return (
    <div>
      <h2>Batch {batch.id.slice(0, 8)}</h2>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <p>
          <strong>Run:</strong> <Link to={`/runs/${batch.runId}`}>{batch.runId}</Link>
        </p>
        <p>
          <strong>Import status:</strong> {batch.importStatus}
        </p>
        <p>
          <strong>Created:</strong> {new Date(batch.createdAt).toLocaleString()}
        </p>
      </div>

      <div className="card">
        <h3>Immutable generated files</h3>
        <p style={{ fontSize: 13, color: "#64748b" }}>
          Inspect these files before importing. The update and rollback CSVs are paired and frozen; they never change after
          generation.
        </p>
        <ul>
          {batch.updateFileId && (
            <li>
              <a href={api.downloadFileUrl(batch.updateFileId)}>Download update CSV (import this into the Miva development store)</a>
            </li>
          )}
          {batch.rollbackFileId && (
            <li>
              <a href={api.downloadFileUrl(batch.rollbackFileId)}>Download rollback CSV (keep for recovery)</a>
            </li>
          )}
          {batch.exceptionFileId && (
            <li>
              <a href={api.downloadFileUrl(batch.exceptionFileId)}>Download exception CSV</a>
            </li>
          )}
          {batch.reconciliationFileId && (
            <li>
              <a href={api.downloadFileUrl(batch.reconciliationFileId)}>Download full reconciliation CSV</a>
            </li>
          )}
        </ul>
      </div>

      {mivaApi.configured && (
        <div className="card">
          <h3>Push to Miva via API</h3>
          <p style={{ fontSize: 13, color: "#64748b" }}>
            Applies this batch's Update CSV rows directly to Miva via the JSON API, instead of manually importing the
            CSV. Uses the exact same frozen, approved data as the downloadable CSV above.
          </p>
          {mivaApi.environment === "production" && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 8 }}>
              <input type="checkbox" checked={confirmProduction} onChange={(e) => setConfirmProduction(e.target.checked)} />
              I confirm this is a production write to the live Miva store.
            </label>
          )}
          <button
            className="charcoal"
            onClick={pushToMiva}
            disabled={busy || (mivaApi.environment === "production" && !confirmProduction)}
          >
            {busy ? "Pushing..." : "Push to Miva via API"}
          </button>
          {pushResult && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13 }}>
                Pushed: {pushResult.pushed} · Failed: {pushResult.failed} · Verification mismatches:{" "}
                {pushResult.verificationMismatches}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Product code</th>
                    <th>Result</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {pushResult.results.map((r) => (
                    <tr key={r.productCode}>
                      <td>{r.productCode}</td>
                      <td>
                        <span className={`pill ${r.success ? "clean" : "blocked"}`}>{r.success ? "SUCCESS" : "FAILED"}</span>
                      </td>
                      <td>{r.errorMessage ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h3>Import outcome</h3>
        <p style={{ fontSize: 13, color: "#64748b" }}>
          Record what happened when you manually imported the update CSV into the Miva development store.
        </p>
        <div className="toolbar">
          {IMPORT_STATUSES.map((s) => (
            <button key={s} onClick={() => setOutcome(s)} disabled={busy}>
              Mark {s}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Post-import verification</h3>
        <p style={{ fontSize: 13, color: "#64748b" }}>
          Upload a fresh Miva export taken after the import to verify approved changes landed and nothing else moved.
        </p>
        <div className="toolbar">
          <select value={selectedPostImport} onChange={(e) => setSelectedPostImport(e.target.value)}>
            <option value="">Select post-import Miva snapshot...</option>
            {postImportFiles.map((f) => (
              <option key={f.id} value={f.id}>
                {f.originalFilename}
              </option>
            ))}
          </select>
          <button className="primary" onClick={verify} disabled={busy || !selectedPostImport}>
            Run verification
          </button>
        </div>
        {verificationRows && (
          <table>
            <thead>
              <tr>
                <th>Product code</th>
                <th>Result</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {verificationRows.map((r) => (
                <tr key={r.product_code}>
                  <td>{r.product_code}</td>
                  <td>
                    <span className={`pill ${r.result === "PASS" ? "clean" : "blocked"}`}>{r.result}</span>
                  </td>
                  <td>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
