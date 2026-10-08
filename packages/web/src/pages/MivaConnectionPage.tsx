import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plug, RotateCcw, Upload } from "lucide-react";
import { api, ApiRequestError, type FileRecord, type PushBatchResult } from "../api";
import { InstructionsCard } from "../components/InstructionsCard";
import { ErrorBanner } from "../components/ErrorBanner";
import { friendlyError } from "../lib/errors";

interface MivaApiStatus {
  configured: boolean;
  environment: "development" | "production";
  activeSite: "development" | "live";
}

function DevResetSection({ activeSite }: { activeSite: "development" | "live" | undefined }) {
  const [referenceFile, setReferenceFile] = useState<FileRecord | null>(null);
  const [loadingReference, setLoadingReference] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PushBatchResult | null>(null);

  const CONFIRM_PHRASE = "RESET";

  useEffect(() => {
    api
      .getDevResetReference()
      .then((r) => setReferenceFile(r.file))
      .catch((err) => setError(friendlyError(err, "Failed to load the reset reference file.")))
      .finally(() => setLoadingReference(false));
  }, []);

  async function uploadReference(file: File) {
    setUploading(true);
    setError(null);
    try {
      await api.uploadDevResetReference(file);
      const { file: updated } = await api.getDevResetReference();
      setReferenceFile(updated);
    } catch (err) {
      console.error(err);
      setError(friendlyError(err, "Failed to upload the reset reference file."));
    } finally {
      setUploading(false);
    }
  }

  async function runReset() {
    setResetting(true);
    setError(null);
    setResult(null);
    try {
      const pushResult = await api.runDevReset();
      setResult(pushResult);
      setConfirmText("");
    } catch (err) {
      console.error(err);
      setError(friendlyError(err, "Dev site reset failed."));
    } finally {
      setResetting(false);
    }
  }

  const canReset = activeSite === "development" && Boolean(referenceFile) && confirmText === CONFIRM_PHRASE;

  return (
    <>
      <hr style={{ margin: "20px 0", border: "none", borderTop: "1px solid var(--border)" }} />
      <div
        className={dragging ? "card-dropzone-active" : undefined}
        style={{ borderRadius: 8, padding: 8, margin: -8 }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !uploading) uploadReference(file);
        }}
      >
        <h3>Reset dev site products</h3>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          Pushes the reference CSV below to every product it lists via the Miva API, restoring the dev store's
          managed fields to a known-good baseline. Only available while the active site above is Development -- there
          is no way to run this against Live, even by mistake.
        </p>
        {error && <ErrorBanner message={error} />}

        <h4>Reference file</h4>
        {loadingReference ? (
          <p style={{ fontSize: 13 }}>Loading...</p>
        ) : referenceFile ? (
          <p style={{ fontSize: 13 }}>
            {referenceFile.originalFilename} · {referenceFile.rowCount ?? "?"} rows · uploaded{" "}
            {new Date(referenceFile.uploadedAt).toLocaleString()}
          </p>
        ) : (
          <p style={{ fontSize: 13, color: "var(--red)" }}>No reference file uploaded yet.</p>
        )}
        <label className={`dropzone${dragging ? " dragging" : ""}${uploading ? " busy" : ""}`} style={{ maxWidth: 320 }}>
          <input
            type="file"
            accept=".csv"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadReference(file);
              e.target.value = "";
            }}
          />
          <Upload size={16} />
          <span>{uploading ? "Uploading..." : "Drag a file here, or click to browse"}</span>
        </label>
      </div>

      <h4 style={{ marginTop: 20 }}>Run reset</h4>
      <div className="toolbar">
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={CONFIRM_PHRASE}
          style={{ width: 160 }}
        />
        <button className="danger" onClick={runReset} disabled={resetting || !canReset}>
          <RotateCcw size={16} /> {resetting ? "Resetting..." : "Reset Dev Site Products"}
        </button>
      </div>

      {result && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13 }}>
            Pushed: {result.pushed} · Failed: {result.failed} · Verification mismatches: {result.verificationMismatches}
          </p>
          {result.failed > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {result.results
                  .filter((r) => !r.success)
                  .map((r) => (
                    <tr key={r.productCode}>
                      <td>{r.productCode}</td>
                      <td>
                        <span className="pill blocked">FAILED</span>
                      </td>
                      <td>{r.errorMessage ?? r.errorCode ?? ""}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

function SiteSwitcher({ status, onChanged }: { status: MivaApiStatus | null; onChanged: (status: MivaApiStatus) => void }) {
  const [pending, setPending] = useState<"development" | "live" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirror a fresh status fetch (or a just-applied save) into the pending
  // selection, so the radios always reflect the real active site until the
  // admin starts changing it.
  useEffect(() => {
    if (status) setPending(status.activeSite);
  }, [status]);

  const dirty = Boolean(status && pending && pending !== status.activeSite);

  async function save() {
    if (!status || !pending || pending === status.activeSite) return;
    if (
      !window.confirm(
        `Switch the active Miva site to ${pending === "live" ? "Live" : "Development"}? This changes which store's credentials every Miva API call (pull, push, dev reset) uses app-wide, immediately, for all users.`,
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.setMivaActiveSite(pending);
      onChanged(updated);
    } catch (err) {
      console.error(err);
      setError(friendlyError(err, "Failed to switch site."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h3>Active Miva site</h3>
      <p style={{ fontSize: 13, color: "var(--muted)" }}>
        Controls which store's credentials every Miva API call (pull, push, dev reset) uses, and whether pushing a
        batch requires the production confirmation checkbox. Only Development has real credentials configured today
        -- switching to Live before its credentials are set will make any Miva API call fail with a clear error,
        rather than silently falling back to Development.
      </p>
      {error && <ErrorBanner message={error} />}
      <div className="filters">
        <label>
          <input
            type="radio"
            checked={pending === "development"}
            disabled={saving || !status}
            onChange={() => setPending("development")}
          />{" "}
          Development
        </label>
        <label style={{ marginLeft: 16 }}>
          <input
            type="radio"
            checked={pending === "live"}
            disabled={saving || !status}
            onChange={() => setPending("live")}
          />{" "}
          Live {status?.activeSite === "live" && !status.configured && (
            <span style={{ color: "var(--red)" }}>(not configured yet)</span>
          )}
        </label>
        <button onClick={save} disabled={saving || !dirty} style={{ marginLeft: 16 }}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
      {status && (
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
          Currently configured: {status.configured ? "yes" : "no"} · Push confirmation required:{" "}
          {status.environment === "production" ? "yes" : "no"}
        </p>
      )}
      {status?.activeSite === "development" && <DevResetSection activeSite={status.activeSite} />}
    </div>
  );
}

export default function MivaConnectionPage() {
  const [status, setStatus] = useState<MivaApiStatus | null>(null);

  useEffect(() => {
    api
      .getMivaApiStatus()
      .then(setStatus)
      .catch((err) => console.error(err instanceof ApiRequestError ? err.body.message : err));
  }, []);

  return (
    <div>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Plug size={24} strokeWidth={2.25} /> Miva Connection
      </h2>
      <InstructionsCard
        pageKey="miva-connection"
        description="Switch which Miva store (Development or Live) the app talks to, and reset the dev store's products back to a known baseline for testing."
      />
      <div className="card">
        <Link to="/settings">Back to settings</Link>
      </div>
      <SiteSwitcher status={status} onChanged={setStatus} />
    </div>
  );
}
