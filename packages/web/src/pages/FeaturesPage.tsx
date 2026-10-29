import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ToggleRight } from "lucide-react";
import { api, type FeatureFlags } from "../api";
import { useAuth } from "../AuthContext";
import { InstructionsCard } from "../components/InstructionsCard";
import { ErrorBanner } from "../components/ErrorBanner";
import { friendlyError } from "../lib/errors";

const FEATURES: { key: keyof FeatureFlags; title: string; description: string }[] = [
  {
    key: "catalogViews",
    title: "Saved Catalog views",
    description:
      "Lets people save the Miva Catalog's columns, column order and widths, filters and sort as named views, share them with the team, and pick a default view. When off, the Catalog works as it did before and the View bar is hidden. Views people already saved are kept and come back when you turn it on.",
  },
];

export default function FeaturesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [flags, setFlags] = useState<FeatureFlags | null>(null);
  const [savingKey, setSavingKey] = useState<keyof FeatureFlags | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getFeatures()
      .then(setFlags)
      .catch((err) => setError(friendlyError(err, "Failed to load the feature settings.")));
  }, []);

  async function toggle(key: keyof FeatureFlags, enabled: boolean) {
    setSavingKey(key);
    setError(null);
    try {
      setFlags(await api.setFeatures({ [key]: enabled }));
    } catch (err) {
      console.error(err);
      setError(friendlyError(err, "Failed to save the feature setting."));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ToggleRight size={24} strokeWidth={2.25} /> Features
      </h2>
      <InstructionsCard
        pageKey="features"
        description="Turn optional features on or off for everyone. New features start off until an admin enables them; a change applies the next time someone loads or refreshes the page."
      />
      <div className="card">
        <Link to="/settings">Back to settings</Link>
      </div>
      <div className="card">
        {error && <ErrorBanner message={error} />}
        {!isAdmin && <p style={{ fontSize: 13, color: "var(--muted)" }}>Only an admin can change these settings.</p>}
        {FEATURES.map((f) => (
          <div key={f.key} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "8px 0" }}>
            <input
              id={`feature-${f.key}`}
              type="checkbox"
              checked={flags?.[f.key] === true}
              disabled={!isAdmin || flags === null || savingKey === f.key}
              onChange={(e) => toggle(f.key, e.target.checked)}
              style={{ marginTop: 4 }}
            />
            <label htmlFor={`feature-${f.key}`}>
              <strong>{f.title}</strong> {flags !== null && <span style={{ color: "var(--muted)" }}>({flags[f.key] ? "On" : "Off"})</span>}
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{f.description}</div>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
