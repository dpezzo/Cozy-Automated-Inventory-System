import { useState } from "react";
import { Upload } from "lucide-react";
import { api, type FileRecord } from "../api";
import { friendlyError } from "../lib/errors";

/** Upload state + submit logic, shared between a field-level dropzone and a whole-card dropzone around it. */
export function useUploadControl(kind: string, onUploaded: (file: FileRecord) => void) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingDuplicateFile, setPendingDuplicateFile] = useState<File | null>(null);

  async function handleFile(file: File, confirmDuplicate = false) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.uploadFile(file, kind, confirmDuplicate);
      if (result.duplicateWarning && !confirmDuplicate) {
        setMessage(
          result.duplicateWarning +
            " Uploading it again would create a separate copy and could result in two runs for the same data. Click Upload again to store it as a new copy anyway, or select the existing file from the dropdown below instead.",
        );
        setPendingDuplicateFile(file);
      } else {
        setMessage(`Uploaded: ${result.file.originalFilename} (${result.file.rowCount ?? "?"} rows)`);
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

/** Bare upload UI (no outer card) -- the field-level dropzone, for embedding inside a TabbedCard/OrDividerRow item or a whole-card dropzone. */
export function UploadControlView({
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
      {hint && <p style={{ fontSize: 13, color: "var(--muted)", marginTop: -4 }}>{hint}</p>}
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
        <Upload size={16} />
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
export function WholeCardDropzone({
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

/** Standalone card version, used for uploads that aren't part of a tabbed section. */
export function UploadBox({
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
