import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiRequestError, type FileRecord, type RunRecord, type BatchRecord } from "../api";

function UploadBox({
  kind,
  label,
  hint,
  onUploaded,
}: {
  kind: string;
  label: string;
  hint?: string;
  onUploaded: (file: FileRecord) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingDuplicateFile, setPendingDuplicateFile] = useState<File | null>(null);

  async function handleFile(file: File, confirmDuplicate = false) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.uploadFile(file, kind, confirmDuplicate);
      if (result.duplicateWarning && !confirmDuplicate) {
        setMessage(result.duplicateWarning + " Click Upload again to store it as a new copy, or reuse the existing file below.");
        setPendingDuplicateFile(file);
      } else {
        setMessage(`Uploaded: ${result.file.originalFilename} (${result.file.rowCount ?? "?"} rows)`);
        setPendingDuplicateFile(null);
      }
      onUploaded(result.file);
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? `${err.body.error}: ${err.body.message}` : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>{label}</h3>
      {hint && <p style={{ fontSize: 13, color: "#64748b", marginTop: -4 }}>{hint}</p>}
      <input
        type="file"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file, false);
        }}
      />
      {pendingDuplicateFile && (
        <button style={{ marginLeft: 8 }} onClick={() => handleFile(pendingDuplicateFile, true)} disabled={busy}>
          Confirm duplicate upload
        </button>
      )}
      {message && <p style={{ fontSize: 13, marginTop: 8 }}>{message}</p>}
    </div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [olliixFiles, setOlliixFiles] = useState<FileRecord[]>([]);
  const [mivaFiles, setMivaFiles] = useState<FileRecord[]>([]);
  const [selectedOlliix, setSelectedOlliix] = useState<string>("");
  const [selectedMiva, setSelectedMiva] = useState<string>("");
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [ol, mv, r, b] = await Promise.all([
      api.listFiles("olliix_workbook"),
      api.listFiles("miva_snapshot"),
      api.listRuns(),
      api.listBatches(),
    ]);
    setOlliixFiles(ol);
    setMivaFiles(mv);
    setRuns(r);
    setBatches(b);
    if (!selectedOlliix && ol[0]) setSelectedOlliix(ol[0].id);
    if (!selectedMiva && mv[0]) setSelectedMiva(mv[0].id);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startReconciliation() {
    if (!selectedOlliix || !selectedMiva) return;
    setStarting(true);
    setError(null);
    try {
      const run = await api.createRun(selectedOlliix, selectedMiva);
      navigate(`/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to start reconciliation.");
    } finally {
      setStarting(false);
    }
  }

  const attention = runs.filter((r) => r.status === "failed").length;
  const awaitingOutcome = batches.filter((b) => b.importStatus === "GENERATED" || b.importStatus === "DOWNLOADED").length;

  return (
    <div>
      <h2>Home</h2>
      {error && <div className="error-banner">{error}</div>}

      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        <div className="stat">
          <div className="value">{runs.length}</div>
          <div className="label">Total runs</div>
        </div>
        <div className="stat">
          <div className="value">{attention}</div>
          <div className="label">Runs requiring attention (failed)</div>
        </div>
        <div className="stat">
          <div className="value">{awaitingOutcome}</div>
          <div className="label">Batches awaiting import outcome</div>
        </div>
        <div className="stat">
          <div className="value">{batches.filter((b) => b.importStatus === "VERIFICATION_FAILED").length}</div>
          <div className="label">Batches with failed verification</div>
        </div>
      </div>

      <div className="grid cols-2">
        <UploadBox
          kind="olliix_workbook"
          label="Upload Olliix workbook (.xlsx)"
          hint="The current Olliix 'Item Inventory' export. Required for every reconciliation run."
          onUploaded={refresh}
        />
        <UploadBox
          kind="miva_snapshot"
          label="Upload Miva catalog snapshot (.csv)"
          hint="A full current Miva catalog export. Required for every reconciliation run."
          onUploaded={refresh}
        />
      </div>
      <div className="grid cols-2">
        <UploadBox
          kind="legacy_audit"
          label="Upload legacy Olliix_Audit_Master CSV (optional, one-time)"
          hint="Only for the old Excel/Power Query workbook's 'Olliix_Audit_Master' export (columns like SKU, UPC, Expected Date, PRODUCT_CODE). This is a one-time check that the app matches the old system's behavior, not a regular Miva import/export file. Skip this if you don't maintain that workbook — it isn't part of the normal reconciliation workflow."
          onUploaded={refresh}
        />
        <UploadBox
          kind="post_import_snapshot"
          label="Upload a post-import Miva export (for batch verification)"
          hint="A full Miva catalog export taken after you manually import a generated Update CSV, used to verify the import landed correctly."
          onUploaded={refresh}
        />
      </div>

      <div className="card">
        <h3>Start reconciliation</h3>
        <div className="grid cols-2">
          <label>
            Olliix workbook
            <br />
            <select value={selectedOlliix} onChange={(e) => setSelectedOlliix(e.target.value)} style={{ width: "100%" }}>
              <option value="">Select a file...</option>
              {olliixFiles.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.originalFilename} ({f.rowCount} rows, {new Date(f.uploadedAt).toLocaleString()})
                </option>
              ))}
            </select>
          </label>
          <label>
            Miva snapshot
            <br />
            <select value={selectedMiva} onChange={(e) => setSelectedMiva(e.target.value)} style={{ width: "100%" }}>
              <option value="">Select a file...</option>
              {mivaFiles.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.originalFilename} ({f.rowCount} rows, {new Date(f.uploadedAt).toLocaleString()})
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="primary"
          style={{ marginTop: 16 }}
          disabled={!selectedOlliix || !selectedMiva || starting}
          onClick={startReconciliation}
        >
          {starting ? "Starting..." : "Start reconciliation"}
        </button>
      </div>

      <div className="card">
        <h3>Recent runs</h3>
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Status</th>
              <th>Rule</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td>{r.status}</td>
                <td>{r.ruleId}</td>
                <td>
                  <a href={`/runs/${r.id}`}>Open</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
