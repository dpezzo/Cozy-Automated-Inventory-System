import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiRequestError, VENDOR_FILE_DEFS, type FileRecord, type RunRecord, type BatchRecord } from "../api";

/** Upload state + submit logic, shared between a field-level dropzone and a whole-card dropzone around it. */
function useUploadControl(kind: string, onUploaded: (file: FileRecord) => void) {
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

  return { busy, message, pendingDuplicateFile, handleFile };
}

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
      setMessage(err instanceof ApiRequestError ? `${err.body.error}: ${err.body.message}` : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return { busy, message, pendingDuplicateFile, handleFile };
}

/** Bare upload UI (no outer card) -- the field-level dropzone, for embedding inside a TabbedCard/OrDividerRow item or a whole-card dropzone. */
function UploadControlView({
  kind,
  label,
  hint,
  state,
}: {
  kind: string;
  label: string;
  hint?: string;
  state: ReturnType<typeof useUploadControl>;
}) {
  const [dragging, setDragging] = useState(false);
  const inputId = `upload-${kind}`;
  const { busy, message, pendingDuplicateFile, handleFile } = state;

  return (
    <div>
      <h4 style={{ marginTop: 0 }}>{label}</h4>
      {hint && <p style={{ fontSize: 13, color: "#64748b", marginTop: -4 }}>{hint}</p>}
      <label
        htmlFor={inputId}
        className={`dropzone${dragging ? " dragging" : ""}${busy ? " busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !busy) handleFile(file, false);
        }}
      >
        <input
          id={inputId}
          type="file"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file, false);
            e.target.value = "";
          }}
        />
        <span>{busy ? "Uploading..." : "Drag a file here, or click to browse"}</span>
      </label>
      {pendingDuplicateFile && (
        <button style={{ marginTop: 10, display: "block" }} onClick={() => handleFile(pendingDuplicateFile, true)} disabled={busy}>
          Confirm duplicate upload
        </button>
      )}
      {message && <p style={{ fontSize: 13, marginTop: 8 }}>{message}</p>}
    </div>
  );
}

/**
 * Makes its whole card area a dropzone (not just the small field-level one
 * inside it) -- drop a file anywhere on the card, not only on the dashed
 * strip. A no-op wrapper (just renders a plain card) when `onFile` is omitted.
 */
function WholeCardDropzone({
  onFile,
  disabled,
  children,
}: {
  onFile?: (file: File) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const active = Boolean(onFile) && !disabled;

  return (
    <div
      className={`card${dragging && active ? " card-dropzone-active" : ""}`}
      onDragOver={(e) => {
        if (!active) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!active) return;
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile!(file);
      }}
    >
      {children}
    </div>
  );
}

/** Standalone card version, used for the Advanced/one-time uploads which aren't part of a tabbed section. */
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
  const state = useUploadControl(kind, onUploaded);
  return (
    <WholeCardDropzone onFile={(file) => state.handleFile(file, false)} disabled={state.busy}>
      <UploadControlView kind={kind} label={label} hint={hint} state={state} />
    </WholeCardDropzone>
  );
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
      setMessage(err instanceof ApiRequestError ? `${err.body.error}: ${err.body.message}` : "Pull failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h4 style={{ marginTop: 0 }}>Pull Miva catalog snapshot via API</h4>
      <p style={{ fontSize: 13, color: "#64748b", marginTop: -4 }}>
        Fetches the full current catalog directly from Miva instead of a manual CSV export.
      </p>
      <button className="charcoal" onClick={pull} disabled={busy}>
        {busy ? "Pulling..." : "Pull from Miva API"}
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

/** The numbered step badge, or a green checkmark once at least one file for that step exists. */
function StepBadge({ step, complete }: { step: number; complete?: boolean }) {
  return <span className={`step-badge${complete ? " complete" : ""}`}>{complete ? "✓" : step}</span>;
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
        hint="A full current Miva catalog export. Required for every reconciliation run."
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
          <span>(temporary preview switcher -- tell me which one to keep)</span>
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

function AdvancedUploadsSection({ onChanged }: { onChanged: (file: FileRecord) => void }) {
  return (
    <details className="advanced-details">
      <summary>Advanced / one-time options</summary>
      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <UploadBox
          kind="legacy_audit"
          label="Upload legacy Olliix_Audit_Master CSV (optional, one-time)"
          hint="Only for the old Excel/Power Query workbook's 'Olliix_Audit_Master' export (columns like SKU, UPC, Expected Date, PRODUCT_CODE). This is a one-time check that the app matches the old system's behavior, not a regular Miva import/export file. Skip this if you don't maintain that workbook — it isn't part of the normal reconciliation workflow."
          onUploaded={onChanged}
        />
        <UploadBox
          kind="post_import_snapshot"
          label="Upload a post-import Miva export (for batch verification)"
          hint="A full Miva catalog export taken after you manually import a generated Update CSV, used to verify the import landed correctly."
          onUploaded={onChanged}
        />
      </div>
    </details>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [vendorFiles, setVendorFiles] = useState<FileRecord[]>([]);
  const [mivaFiles, setMivaFiles] = useState<FileRecord[]>([]);
  const [selectedVendorFile, setSelectedVendorFile] = useState<string>("");
  const [selectedMiva, setSelectedMiva] = useState<string>("");
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mivaApiConfigured, setMivaApiConfigured] = useState(false);

  async function refresh() {
    const [vf, mv, r, b] = await Promise.all([
      api.listVendorFiles(),
      api.listFiles("miva_snapshot"),
      api.listRuns(),
      api.listBatches(),
    ]);
    setVendorFiles(vf);
    setMivaFiles(mv);
    setRuns(r);
    setBatches(b);
    // Deliberately no auto-select of an existing file here: a returning visit
    // to this page should never silently pre-load "whichever file happens to
    // be newest" into Start Reconciliation. Selecting a file for a run is
    // always an explicit choice -- the only auto-select is in
    // handleFileChanged, immediately after *this session* uploads/pulls one.
  }

  const vendorFileKinds = new Set<string>(VENDOR_FILE_DEFS.map((v) => v.kind));

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

  async function startReconciliation() {
    if (!selectedVendorFile || !selectedMiva) return;
    setStarting(true);
    setError(null);
    try {
      const run = await api.createRun(selectedVendorFile, selectedMiva);
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

      <VendorDataSection step={1} complete={Boolean(selectedVendorFile)} onChanged={handleFileChanged} />
      <MivaCatalogDataSection
        step={2}
        complete={Boolean(selectedMiva)}
        mivaApiConfigured={mivaApiConfigured}
        onChanged={handleFileChanged}
      />

      <div className="card">
        <div className="step-header">
          <span className="step-badge">3</span>
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
                  {VENDOR_FILE_DEFS.find((v) => v.kind === f.kind)?.label ?? f.kind} — {f.originalFilename} (
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
              fontSize: 13,
              color: "#92400e",
              background: "#fffbeb",
              border: "1px dashed var(--amber)",
              borderRadius: 8,
              padding: "8px 12px",
              marginTop: 16,
              marginBottom: 0,
            }}
          >
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
          onClick={startReconciliation}
        >
          {starting ? "Starting..." : "Start reconciliation"}
        </button>
      </div>

      <AdvancedUploadsSection onChanged={refresh} />

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
