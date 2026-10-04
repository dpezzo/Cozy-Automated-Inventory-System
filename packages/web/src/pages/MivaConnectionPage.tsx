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

function SiteSwitcher({ status, onChanged }: { status: MivaApiStatus | null; onChanged: (status: MivaApiStatus) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectSite(site: "development" | "live") {
    if (!status || site === status.activeSite) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.setMivaActiveSite(site);
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
            checked={status?.activeSite === "development"}
            disabled={saving || !status}
            onChange={() => selectSite("development")}
          />{" "}
          Development
        </label>
        <label style={{ marginLeft: 16 }}>
          <input
            type="radio"
            checked={status?.activeSite === "live"}
            disabled={saving || !status}
            onChange={() => selectSite("live")}
          />{" "}
          Live {status?.activeSite === "live" && !status.configured && (
            <span style={{ color: "var(--red)" }}>(not configured yet)</span>
          )}
        </label>
      </div>
      {status && (
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
          Currently configured: {status.configured ? "yes" : "no"} · Push confirmation required:{" "}
          {status.environment === "production" ? "yes" : "no"}
        </p>
      )}
    </div>
  );
}

function DevResetCard({ activeSite }: { activeSite: "development" | "live" | undefined }) {
  const [referenceFile, setReferenceFile] = useState<FileRecord | null>(null);
  const [loadingReference, setLoadingReference] = useState(true);
  const [uploading, setUploading] = useState(false);
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
    <div className="card">
      <h3>Reset dev site products</h3>
      <p style={{ fontSize: 13, color: "var(--muted)" }}>
        Pushes the reference CSV below to every product it lists via the Miva API, restoring the dev store's managed
        fields to a known-good baseline. Only runs while the active site above is Development -- there is no way to
        run this against Live, even by mistake.
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
      <label className={`dropzone${uploading ? " busy" : ""}`} style={{ maxWidth: 320 }}>
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
        <Upload size={14} />
        <span>{uploading ? "Uploading..." : "Upload new reference file"}</span>
      </label>

      <h4 style={{ marginTop: 20 }}>Run reset</h4>
      {activeSite !== "development" ? (
        <p style={{ fontSize: 13, color: "var(--red)" }}>Switch the active site to Development above to enable this.</p>
      ) : (
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
      )}

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
      <SiteSwitcher status={status} onChanged={setStatus} />
      <DevResetCard activeSite={status?.activeSite} />
      <div className="card">
        <Link to="/settings">Back to settings</Link>
      </div>
    </div>
  );
}
