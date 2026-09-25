import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Play, AlertTriangle, Home, RefreshCcw } from "lucide-react";
import {
  api,
  ApiRequestError,
  VENDOR_FILE_KINDS,
  vendorLabelForFile,
  type FileRecord,
  type RunRecord,
  type BatchRecord,
  type VendorSummary,
} from "../api";
import { useUploadControl, UploadControlView, WholeCardDropzone } from "../components/UploadBox";
import { friendlyError } from "../lib/errors";
import { StepBadge } from "../components/StepBadge";
import { InstructionsCard } from "../components/InstructionsCard";
import { HOME_LABEL_OPTIONS, useHomeLabel } from "../HomeLabelContext";
import { ErrorBanner } from "../components/ErrorBanner";

/** Same shape as useUploadControl, but for the single vendor-file upload area -- the vendor is detected server-side from the file's content, never picked via a tab. */
function useVendorAutoUploadControl(onUploaded: (file: FileRecord) => void) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingDuplicateFile, setPendingDuplicateFile] = useState<File | null>(null);

  async function handleFile(file: File, confirmDuplicate = false) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.uploadVendorFile(file, confirmDuplicate);
      if (result.duplicateWarning && !confirmDuplicate) {
        setMessage(result.duplicateWarning + " Click Upload again to store it as a new copy, or reuse the existing file below.");
        setPendingDuplicateFile(file);
      } else {
        setMessage(
          `Detected: ${result.detectedVendorLabel}. Uploaded: ${result.file.originalFilename} (${result.file.rowCount ?? "?"} rows)`,
        );
        setPendingDuplicateFile(null);
      }
      onUploaded(result.file);
    } catch (err) {
      setMessage(friendlyError(err, "Upload failed."));
    } finally {
      setBusy(false);
    }
  }

  return { busy, message, pendingDuplicateFile, handleFile };
}

/** Bare API-pull control (no outer card), for embedding inside TabbedCard/OrDividerRow items. */
function MivaApiPullControl({ onPulled }: { onPulled: (file: FileRecord) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function pull() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.pullMivaSnapshot();
      setMessage(
        result.duplicateWarning ?? `Pulled: ${result.file.originalFilename} (${result.file.rowCount ?? "?"} rows)`,
      );
      onPulled(result.file);
    } catch (err) {
      setMessage(friendlyError(err, "Pull failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h4 style={{ marginTop: 0 }}>Pull Miva catalog snapshot via API</h4>
      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: -4 }}>
        Fetches the full current catalog directly from Miva instead of a manual CSV export.
      </p>
      <button className="charcoal" onClick={pull} disabled={busy}>
        <Download size={16} /> {busy ? "Pulling..." : "Pull from Miva API"}
      </button>
      {message && <p style={{ fontSize: 13, marginTop: 8 }}>{message}</p>}
    </div>
  );
}

interface TabDef {
  key: string;
  label: string;
  content: React.ReactNode;
  /** When set, dropping a file anywhere on the card (while this tab is active) uploads it the same as the field-level dropzone. */
  onFileDrop?: (file: File) => void;
}

/**
 * A card with a numbered step header and, when given more than one tab, a
 * tab strip to switch between them. With a single tab (today's only vendor,
 * Olliix), the tab strip is skipped entirely and it reads as a plain card --
 * adding a second vendor later is just adding a second entry to `tabs`.
 */
function TabbedCard({
  step,
  complete,
  title,
  tabs,
}: {
  step?: number;
  complete?: boolean;
  title: string;
  tabs: TabDef[];
}) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  // Miva API configuration is checked asynchronously, so the first render
  // often only has the CSV tab -- once the API tab appears, keep defaulting
  // to the first (preferred) tab until the user actually picks one by hand.
  const [userPicked, setUserPicked] = useState(false);
  useEffect(() => {
    if (userPicked) return;
    if (tabs[0] && tabs[0].key !== active) setActive(tabs[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, userPicked]);

  const activeTab = tabs.find((t) => t.key === active);

  return (
    <WholeCardDropzone onFile={activeTab?.onFileDrop}>
      <div className="step-header">
        {step !== undefined && <StepBadge step={step} complete={complete} />}
        <h3>{title}</h3>
      </div>
      {tabs.length > 1 && (
        <div className="tab-strip" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={active === t.key}
              className={active === t.key ? "active" : ""}
              onClick={() => {
                setActive(t.key);
                setUserPicked(true);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {activeTab?.content}
    </WholeCardDropzone>
  );
}

/** Alternative to TabbedCard: shows every item side by side with an "OR" divider, instead of tabs. */
function OrDividerRow({
  step,
  complete,
  title,
  items,
}: {
  step?: number;
  complete?: boolean;
  title: string;
  items: TabDef[];
}) {
  return (
    <div className="card">
      <div className="step-header">
        {step !== undefined && <StepBadge step={step} complete={complete} />}
        <h3>{title}</h3>
      </div>
      <div className="or-divider-row">
        {items.map((item, i) => (
          <Fragment key={item.key}>
            {i > 0 && <div className="or-divider-label">OR</div>}
            <WholeCardDropzone onFile={item.onFileDrop}>{item.content}</WholeCardDropzone>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function VendorDataSection({
  step,
  complete,
  onChanged,
}: {
  step: number;
  complete: boolean;
  onChanged: (file: FileRecord) => void;
}) {
  // No per-vendor tabs: one upload area, with the vendor auto-detected
  // server-side from the file's own content (sheet name / required columns),
  // never from a tab the operator has to pick correctly. Adding a new vendor
  // later needs no change here -- detection picks it up automatically once
  // it has a parser + registry entry (see vendorFileRegistry.ts).
  const state = useVendorAutoUploadControl(onChanged);
  const tabs: TabDef[] = [
    {
      key: "vendor-auto",
      label: "Vendor file",
      onFileDrop: (file) => state.handleFile(file, false),
      content: (
        <UploadControlView
          kind="vendor_auto"
          label="Upload vendor inventory file (.xlsx or .csv)"
          hint="Drop any vendor's file -- Olliix, K&H, Gobi, or FieldSheer/MobileWarming. The vendor is detected automatically from the file's contents."
          state={state}
        />
      ),
    },
  ];
  return <TabbedCard step={step} complete={complete} title="Vendor Inventory Data" tabs={tabs} />;
}

function MivaCatalogDataSection({
  step,
  complete,
  mivaApiConfigured,
  onChanged,
}: {
  step: number;
  complete: boolean;
  mivaApiConfigured: boolean;
  onChanged: (file: FileRecord) => void;
}) {
  const [layout, setLayout] = useState<"tabs" | "sidebyside">("tabs");
  const mivaCsv = useUploadControl("miva_snapshot", onChanged);

  // API pull is the preferred, first-choice source; CSV upload is the fallback
  // when the API isn't configured (or a manual export is needed for some
  // other reason), so it's always listed second.
  const items: TabDef[] = [];
  if (mivaApiConfigured) {
    items.push({ key: "api", label: "Pull via API", content: <MivaApiPullControl onPulled={onChanged} /> });
  }
  items.push({
    key: "csv",
    label: "Upload CSV",
    onFileDrop: (file) => mivaCsv.handleFile(file, false),
    content: (
      <UploadControlView
        kind="miva_snapshot"
        label="Upload Miva catalog snapshot (.csv)"
        hint="A full current Miva catalog snapshot. Required for every reconciliation run."
        state={mivaCsv}
      />
    ),
  });

  return (
    <>
      {items.length > 1 && (
        <div className="layout-switcher">
          Preview layout:
          <button className={layout === "tabs" ? "active" : ""} onClick={() => setLayout("tabs")}>
            Tabs
          </button>
          <button className={layout === "sidebyside" ? "active" : ""} onClick={() => setLayout("sidebyside")}>
            Side-by-side
          </button>
          <span>(preview -- pending final decision)</span>
        </div>
      )}
      {layout === "sidebyside" && items.length > 1 ? (
        <OrDividerRow step={step} complete={complete} title="Miva Catalog Data" items={items} />
      ) : (
        <TabbedCard step={step} complete={complete} title="Miva Catalog Data" tabs={items} />
      )}
    </>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const { homeLabel, setHomeLabel } = useHomeLabel();
  const [vendorFiles, setVendorFiles] = useState<FileRecord[]>([]);
  const [mivaFiles, setMivaFiles] = useState<FileRecord[]>([]);
  const [selectedVendorFile, setSelectedVendorFile] = useState<string>("");
  const [selectedMiva, setSelectedMiva] = useState<string>("");
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mivaApiConfigured, setMivaApiConfigured] = useState(false);
  const [vendors, setVendors] = useState<VendorSummary[]>([]);

  async function refresh() {
    const [vf, mv, r, b, vendorList] = await Promise.all([
      api.listVendorFiles(),
      api.listFiles("miva_snapshot"),
      api.listRuns(),
      api.listBatches(),
      api.listVendorSummaries(),
    ]);
    setVendorFiles(vf);
    setMivaFiles(mv);
    setRuns(r);
    setBatches(b);
    setVendors(vendorList);
    // Deliberately no auto-select of an existing file here: a returning visit
    // to this page should never silently pre-load "whichever file happens to
    // be newest" into Start Reconciliation. Selecting a file for a run is
    // always an explicit choice -- the only auto-select is in
    // handleFileChanged, immediately after *this session* uploads/pulls one.
  }

  const vendorFileKinds = new Set<string>(VENDOR_FILE_KINDS);

  function handleFileChanged(file: FileRecord) {
    refresh();
    if (vendorFileKinds.has(file.kind)) setSelectedVendorFile(file.id);
    if (file.kind === "miva_snapshot") setSelectedMiva(file.id);
  }

  useEffect(() => {
    refresh();
    api.getMivaApiStatus().then((s) => setMivaApiConfigured(s.configured));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startReconciliation(confirmDuplicate = false) {
    if (!selectedVendorFile || !selectedMiva) return;
    setStarting(true);
    setError(null);
    try {
      const run = await api.createRun(selectedVendorFile, selectedMiva, confirmDuplicate);
      navigate(`/runs/${run.id}`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.body.error === "DUPLICATE_RUN") {
        const existingRunId = (err.body.details as { existingRunId?: string } | undefined)?.existingRunId;
        const proceed = window.confirm(
          `A run already exists for this vendor file and Miva snapshot pair${existingRunId ? ` (run ${existingRunId.slice(0, 8)})` : ""}. ` +
            "Create another run anyway? This is normal when intentionally re-testing the same files, e.g. after a vendor config change.",
        );
        if (proceed) {
          await startReconciliation(true);
          return;
        }
        setStarting(false);
        return;
      }
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to start reconciliation.");
    } finally {
      setStarting(false);
    }
  }

  const attention = runs.filter((r) => r.status === "failed").length;
  const awaitingOutcome = batches.filter((b) => b.importStatus === "GENERATED" || b.importStatus === "DOWNLOADED").length;

  return (
    <div>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {homeLabel === "Run Reconciliation" ? (
          <RefreshCcw size={24} strokeWidth={2.25} />
        ) : (
          <Home size={24} strokeWidth={2.25} />
        )}{" "}
        {homeLabel}
      </h2>
      <div className="layout-switcher">
        Page name:
        {HOME_LABEL_OPTIONS.map((label) => (
          <button key={label} className={homeLabel === label ? "active" : ""} onClick={() => setHomeLabel(label)}>
            {label}
          </button>
        ))}
        <span>(preview -- pending final decision)</span>
      </div>
      {error && <ErrorBanner message={error} />}

      <InstructionsCard
        pageKey="home"
        description="Run a reconciliation by working through the three steps below."
        steps={[
          "Upload the vendor's inventory file (or a file for any of the supported vendors).",
          "Upload a Miva catalog snapshot, pull one via API, or reuse one you already pulled earlier today (e.g. for another vendor) from the dropdown below.",
          "Select both files and start reconciliation to generate a review.",
          "On the next page, review the proposed changes, approve or reject them, and generate a batch -- you'll push it to Miva from there.",
        ]}
      />

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
          <div
            className="label"
            title="Batches whose CSVs were generated/downloaded, but you haven't yet recorded whether the manual Miva import succeeded on the batch's page."
          >
            Batches awaiting import outcome
          </div>
        </div>
        <div className="stat">
          <div className="value">
            {
              batches.filter((b) =>
                ["VERIFICATION_FAILED", "API_PUSH_FAILED", "API_PUSH_PARTIAL_FAILURE"].includes(b.importStatus),
              ).length
            }
          </div>
          <div
            className="label"
            title="Batches where the API push to Miva failed (partly or fully), or where post-import verification found mismatches -- open the batch to investigate."
          >
            Batches with failed verification or push
          </div>
        </div>
      </div>

      <VendorDataSection step={1} complete={Boolean(selectedVendorFile)} onChanged={handleFileChanged} />
      <MivaCatalogDataSection
        step={2}
        complete={Boolean(selectedMiva)}
        mivaApiConfigured={mivaApiConfigured}
        onChanged={handleFileChanged}
      />

      <div className="card">
        <div className="step-header">
          <StepBadge step={3} />
          <h3>Start Reconciliation</h3>
        </div>
        <div className="grid cols-2">
          <label>
            Vendor inventory file
            <br />
            <select
              value={selectedVendorFile}
              onChange={(e) => setSelectedVendorFile(e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="">Select a file...</option>
              {vendorFiles.map((f) => (
                <option key={f.id} value={f.id}>
                  {vendorLabelForFile(f, vendors)} — {f.originalFilename} (
                  {f.rowCount} rows, {new Date(f.uploadedAt).toLocaleString()})
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
        {(!selectedVendorFile || !selectedMiva) && (
          <p
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: "var(--amber)",
              background: "var(--amber-soft)",
              border: "1px dashed var(--amber)",
              borderRadius: 8,
              padding: "8px 12px",
              marginTop: 16,
              marginBottom: 0,
            }}
          >
            <AlertTriangle size={16} style={{ flex: "none" }} />
            Still needed:{" "}
            {[!selectedVendorFile && "Vendor inventory data (Step 1)", !selectedMiva && "Miva catalog data (Step 2)"]
              .filter(Boolean)
              .join(" and ")}
            .
          </p>
        )}
        <button
          className="primary"
          style={{ marginTop: 16 }}
          disabled={!selectedVendorFile || !selectedMiva || starting}
          onClick={() => startReconciliation()}
        >
          <Play size={16} /> {starting ? "Starting..." : "Start reconciliation"}
        </button>
      </div>
    </div>
  );
}
