import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Lock,
  Download,
  UploadCloud,
  AlertTriangle,
  ClipboardCheck,
  CircleDot,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import {
  api,
  ApiRequestError,
  type BatchRecord,
  type FileRecord,
  type VerificationRow,
  type PushBatchResult,
  type VendorSummary,
} from "../api";
import { UploadBox } from "../components/UploadBox";
import { InstructionsCard } from "../components/InstructionsCard";
import { ErrorBanner } from "../components/ErrorBanner";
import { importStatusPillClass, IMPORT_STATUS_TOOLTIPS } from "../lib/format";

const IMPORT_STATUSES = ["GENERATED", "DOWNLOADED", "IMPORT_REPORTED", "IMPORT_FAILED"];
const IMPORT_STATUS_ICONS: Record<string, React.ReactNode> = {
  GENERATED: <CircleDot size={16} />,
  DOWNLOADED: <Download size={16} />,
  IMPORT_REPORTED: <CheckCircle2 size={16} />,
  IMPORT_FAILED: <XCircle size={16} />,
};

/** ruleId is always "<vendorKey>-inventory-v1" (see runPipeline.ts's ruleIdFor) -- strips that fixed suffix to recover the vendorKey for a vendor label lookup. Duplicated from RunHistoryPage.tsx/RunReviewPage.tsx's identical helper since it's a one-liner and pulling in a shared module for it isn't worth the indirection. */
function vendorKeyFromRuleId(ruleId: string): string {
  return ruleId.replace(/-inventory-v1$/, "");
}

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
  const [pushTarget, setPushTarget] = useState<"update" | "rollback">("update");
  const [pushResult, setPushResult] = useState<PushBatchResult | null>(null);
  const [vendorLabel, setVendorLabel] = useState<string | null>(null);
  const [importTab, setImportTab] = useState<"api" | "csv">("api");

  async function load() {
    if (!batchId) return;
    const b = await api.getBatch(batchId);
    setBatch(b);
    const [{ run }, vendors] = await Promise.all([api.getRun(b.runId), api.listVendorSummaries()]);
    const vendorKey = vendorKeyFromRuleId(run.ruleId);
    setVendorLabel(vendors.find((v: VendorSummary) => v.vendorKey === vendorKey)?.vendorLabel ?? vendorKey);
  }

  const loadPostImportFiles = () => {
    api.listFiles("post_import_snapshot").then(setPostImportFiles);
  };

  useEffect(() => {
    load();
    loadPostImportFiles();
    api.getMivaApiStatus().then((s) => {
      setMivaApi(s);
      if (!s.configured) setImportTab("csv");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  async function pushToMiva() {
    if (!batchId) return;
    const target = pushTarget === "rollback" ? "Rollback (undo this batch's changes)" : "Update (apply this batch's changes)";
    const destination = mivaApi.environment === "production" ? "the LIVE production Miva store" : "the Miva development store";
    if (!window.confirm(`Push "${target}" to ${destination}? This writes directly to Miva.`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.pushBatchToMiva(batchId, confirmProduction, pushTarget);
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
      <InstructionsCard
        pageKey="batch-detail"
        description="Review a generated batch, apply it, and verify the import landed correctly."
        steps={[
          "Push the update/rollback to Miva via API -- the default method, and it verifies itself as part of the push.",
          "If you instead downloaded the CSVs and imported manually, record what happened and upload a post-import snapshot to verify the changes landed.",
        ]}
      />
      {error && <ErrorBanner message={error} />}

      <div className="card">
        <div className="grid cols-4">
          <div>
            <strong>Vendor:</strong> {vendorLabel ?? "..."}
          </div>
          <div>
            <strong>Run:</strong> <Link to={`/runs/${batch.runId}`}>{batch.runId.slice(0, 8)}</Link>
          </div>
          <div>
            <strong>Import status:</strong>{" "}
            <span className={`pill ${importStatusPillClass(batch.importStatus)}`} title={IMPORT_STATUS_TOOLTIPS[batch.importStatus]}>
              {batch.importStatus}
            </span>
          </div>
          <div>
            <strong>Created:</strong> {new Date(batch.createdAt).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="card">
        {mivaApi.configured && (
          <div className="tab-strip" role="tablist">
            <button role="tab" aria-selected={importTab === "api"} className={importTab === "api" ? "active" : ""} onClick={() => setImportTab("api")}>
              Push via API (recommended)
            </button>
            <button role="tab" aria-selected={importTab === "csv"} className={importTab === "csv" ? "active" : ""} onClick={() => setImportTab("csv")}>
              Download CSVs (backup method)
            </button>
          </div>
        )}

        {importTab === "api" && mivaApi.configured && (
          <>
            <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <UploadCloud size={16} /> Push to Miva via API
            </h3>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              Applies this batch's Update or Rollback CSV rows directly to Miva via the JSON API -- the default way to
              import a batch. Uses the exact same frozen, approved data as the downloadable CSVs on the other tab.
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 8 }}>
              Push:
              <select value={pushTarget} onChange={(e) => setPushTarget(e.target.value as "update" | "rollback")}>
                <option value="update">Update (apply proposed changes)</option>
                <option value="rollback">Rollback (restore pre-run values)</option>
              </select>
            </label>
            {mivaApi.environment === "production" && (
              <label
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 8, color: "var(--amber)" }}
                title="Production changes are visible to real customers immediately. Development is a safe test store -- nothing here affects customers."
              >
                <input type="checkbox" checked={confirmProduction} onChange={(e) => setConfirmProduction(e.target.checked)} />
                <AlertTriangle size={14} /> I confirm this is a production write to the live Miva store.
              </label>
            )}
            <button
              className="charcoal"
              onClick={pushToMiva}
              disabled={busy || (mivaApi.environment === "production" && !confirmProduction)}
            >
              <UploadCloud size={16} /> {busy ? "Pushing..." : `Push ${pushTarget === "rollback" ? "Rollback" : "Update"} to Miva via API`}
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
          </>
        )}

        {importTab === "csv" && (
          <>
            <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Lock size={16} /> Downloadable files
            </h3>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              Inspect these files before importing. The update and rollback CSVs are paired and locked; they never
              change after generation.
              {mivaApi.configured && " Use these as a backup import method if pushing via API isn't an option."}
            </p>
            <ul>
              {batch.updateFileId && (
                <li>
                  <a href={api.downloadFileUrl(batch.updateFileId)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Download size={14} /> Download update CSV (import this into the Miva development store)
                  </a>
                </li>
              )}
              {batch.rollbackFileId && (
                <li>
                  <a href={api.downloadFileUrl(batch.rollbackFileId)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Download size={14} /> Download rollback CSV (keep for recovery)
                  </a>
                </li>
              )}
              {batch.exceptionFileId && (
                <li>
                  <a href={api.downloadFileUrl(batch.exceptionFileId)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Download size={14} /> Download exception CSV
                  </a>
                </li>
              )}
              {batch.reconciliationFileId && (
                <li>
                  <a href={api.downloadFileUrl(batch.reconciliationFileId)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Download size={14} /> Download full reconciliation CSV
                  </a>
                </li>
              )}
            </ul>

            <h3 style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 24 }}>
              <ClipboardCheck size={16} /> Import outcome
            </h3>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              Record what happened when you manually imported the update CSV into the Miva development store.
            </p>
            <div className="toolbar">
              {IMPORT_STATUSES.map((s) => (
                <button key={s} onClick={() => setOutcome(s)} disabled={busy} title={IMPORT_STATUS_TOOLTIPS[s]}>
                  {IMPORT_STATUS_ICONS[s]} Mark {s}
                </button>
              ))}
            </div>

            <h3 style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 24 }}>
              <CheckCircle2 size={16} /> Post-import verification
            </h3>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              Upload a fresh Miva snapshot taken after the import to verify approved changes landed and nothing else moved.
            </p>
            <UploadBox
              kind="post_import_snapshot"
              label="Upload a post-import Miva snapshot"
              hint="A full Miva catalog snapshot taken after you manually import a generated Update CSV, used to verify the import landed correctly."
              onUploaded={loadPostImportFiles}
            />
            <div className="toolbar" style={{ marginTop: 12 }}>
              <select value={selectedPostImport} onChange={(e) => setSelectedPostImport(e.target.value)}>
                <option value="">Select post-import Miva snapshot...</option>
                {postImportFiles.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.originalFilename}
                  </option>
                ))}
              </select>
              <button className="primary" onClick={verify} disabled={busy || !selectedPostImport}>
                <RefreshCw size={16} /> Run verification
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
          </>
        )}
      </div>
    </div>
  );
}
