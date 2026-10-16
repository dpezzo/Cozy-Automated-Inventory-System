import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import { api } from "../api";
import { InstructionsCard } from "../components/InstructionsCard";
import { ErrorBanner } from "../components/ErrorBanner";
import { friendlyError } from "../lib/errors";

interface ReportSettings {
  email: string;
  enabled: boolean;
}

export default function EmailReportsPage() {
  const [current, setCurrent] = useState<ReportSettings | null>(null);
  const [pendingEmail, setPendingEmail] = useState("");
  const [pendingEnabled, setPendingEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getReportSettings()
      .then((r) => {
        setCurrent(r);
        setPendingEmail(r.email);
        setPendingEnabled(r.enabled);
      })
      .catch((err) => setLoadError(friendlyError(err, "Failed to load the current report settings.")));
  }, []);

  const dirty = Boolean(current) && (pendingEmail !== current!.email || pendingEnabled !== current!.enabled);

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await api.setReportSettings(pendingEmail, pendingEnabled);
      setCurrent(updated);
      setSaved(true);
    } catch (err) {
      console.error(err);
      setSaveError(friendlyError(err, "Failed to save the report settings."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Mail size={24} strokeWidth={2.25} /> Email Reports
      </h2>
      <InstructionsCard
        pageKey="email-reports"
        description="Choose who receives the HTML summary email sent whenever a batch is pushed to or rolled back on the Miva site -- on either Development or Live -- and turn the report on or off."
      />
      <div className="card">
        <Link to="/settings">Back to settings</Link>
      </div>
      <div className="card">
        <h3>Batch push/rollback reports</h3>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          Every time a batch push or rollback finishes -- success, partial failure, or full failure -- a summary
          email is sent with links back to the run and batch, where a rollback can be triggered from if needed.
        </p>
        {loadError && <ErrorBanner message={loadError} />}
        {saveError && <ErrorBanner message={saveError} />}
        <div className="filters">
          <label>
            <input
              type="checkbox"
              checked={pendingEnabled}
              disabled={!current}
              onChange={(e) => {
                setPendingEnabled(e.target.checked);
                setSaved(false);
              }}
            />{" "}
            Send these emails
          </label>
        </div>
        <div className="filters" style={{ marginTop: 8 }}>
          <input
            type="email"
            value={pendingEmail}
            disabled={!current || !pendingEnabled}
            onChange={(e) => {
              setPendingEmail(e.target.value);
              setSaved(false);
            }}
            placeholder="dev@delutti.com"
            style={{ width: 280 }}
          />
          <button onClick={save} disabled={saving || !dirty || !pendingEmail}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
        {saved && <p style={{ fontSize: 13, color: "var(--green)", marginTop: 8 }}>Saved.</p>}
      </div>
    </div>
  );
}
