import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Timer } from "lucide-react";
import { api } from "../api";
import { InstructionsCard } from "../components/InstructionsCard";
import { ErrorBanner } from "../components/ErrorBanner";
import { friendlyError } from "../lib/errors";

const MIN_MINUTES = 5;
const MAX_MINUTES = 480;

export default function SessionTimeoutPage() {
  const [current, setCurrent] = useState<number | null>(null);
  const [pending, setPending] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getSessionConfig()
      .then((c) => {
        setCurrent(c.idleTimeoutMinutes);
        setPending(String(c.idleTimeoutMinutes));
      })
      .catch((err) => setLoadError(friendlyError(err, "Failed to load the current session timeout.")));
  }, []);

  const pendingNumber = Number(pending);
  const pendingValid = Number.isFinite(pendingNumber) && pendingNumber >= MIN_MINUTES && pendingNumber <= MAX_MINUTES;
  const dirty = current !== null && pendingValid && pendingNumber !== current;

  async function save() {
    if (!pendingValid) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await api.setIdleTimeoutMinutes(pendingNumber);
      setCurrent(updated.idleTimeoutMinutes);
      setSaved(true);
    } catch (err) {
      console.error(err);
      setSaveError(friendlyError(err, "Failed to save the session timeout."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Timer size={24} strokeWidth={2.25} /> Session Timeout
      </h2>
      <InstructionsCard
        pageKey="session-timeout"
        description="Choose how many minutes of inactivity sign a user out automatically. Everyone sees a warning with a 60-second countdown (and a 'Stay signed in' button) before it happens."
      />
      <div className="card">
        <Link to="/settings">Back to settings</Link>
      </div>
      <div className="card">
        <h3>Idle timeout</h3>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          Applies to every signed-in user, app-wide. Minimum {MIN_MINUTES} minutes, maximum {MAX_MINUTES} minutes (
          {(MAX_MINUTES / 60).toFixed(0)} hours). The warning appears 60 seconds before sign-out, so the real idle
          window before the warning is this value minus one minute.
        </p>
        {loadError && <ErrorBanner message={loadError} />}
        {saveError && <ErrorBanner message={saveError} />}
        <div className="filters">
          <input
            type="number"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            value={pending}
            disabled={current === null}
            onChange={(e) => {
              setPending(e.target.value);
              setSaved(false);
            }}
            style={{ width: 100 }}
          />
          <span style={{ fontSize: 13, color: "var(--muted)" }}>minutes</span>
          <button onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
        {!pendingValid && pending !== "" && (
          <p style={{ fontSize: 13, color: "var(--red)", marginTop: 8 }}>
            Enter a whole number between {MIN_MINUTES} and {MAX_MINUTES}.
          </p>
        )}
        {saved && <p style={{ fontSize: 13, color: "var(--green)", marginTop: 8 }}>Saved.</p>}
      </div>
    </div>
  );
}
