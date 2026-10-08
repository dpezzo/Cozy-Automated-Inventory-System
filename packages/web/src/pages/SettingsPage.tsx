import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ReleaseNoteEntry } from "../api";
import { InstructionsCard } from "../components/InstructionsCard";
import { useAuth } from "../AuthContext";
import { Users, Truck, Trash2, Settings, Plug, Activity } from "lucide-react";

/** "2026-10-07" -> "2026.10.07", matching the app's date-based version-number format. */
function formatVersion(isoDate: string): string {
  return isoDate.replace(/-/g, ".");
}

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [commitSha, setCommitSha] = useState<string | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNoteEntry[]>([]);

  useEffect(() => {
    api
      .getHealth()
      .then((h) => setCommitSha(h.commitSha))
      .catch(() => setCommitSha(null));
    api.getReleaseNotes().then(setReleaseNotes).catch(() => setReleaseNotes([]));
  }, []);

  return (
    <div>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Settings size={24} strokeWidth={2.25} /> Settings
      </h2>
      <InstructionsCard pageKey="settings" description="Admin-only tools for managing users, vendors, and stored data." />
      <div className="grid cols-3">
        <Link to="/settings/users" className="card settings-tile">
          <div className="settings-tile-icon">
            <Users size={24} />
          </div>
          <h3>Manage Users</h3>
          <p>Add operators and admins, change roles, deactivate accounts.</p>
        </Link>
        <Link to="/settings/vendors" className="card settings-tile">
          <div className="settings-tile-icon">
            <Truck size={24} />
          </div>
          <h3>Manage Vendors</h3>
          <p>Configure vendor file shapes, column mappings, and matching rules.</p>
        </Link>
        <Link to="/settings/clear-data" className="card settings-tile">
          <div className="settings-tile-icon">
            <Trash2 size={24} />
          </div>
          <h3>Clear Data</h3>
          <p>
            <strong>Permanently</strong> delete old runs, batches, and their files to free up space, or reset for a
            fresh install.
          </p>
        </Link>
        <Link to="/settings/miva-connection" className="card settings-tile">
          <div className="settings-tile-icon">
            <Plug size={24} />
          </div>
          <h3>Miva Connection</h3>
          <p>Switch between the Development and Live Miva sites, and reset the dev store's products to a baseline.</p>
        </Link>
        {isAdmin && (
          <Link to="/settings/activity-log" className="card settings-tile">
            <div className="settings-tile-icon">
              <Activity size={24} />
            </div>
            <h3>Activity Log</h3>
            <p>Browse every significant action recorded across the app (runs, batches, vendor/user changes, etc.).</p>
          </Link>
        )}
      </div>
      {(commitSha || releaseNotes.length > 0) && (
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 24 }}>
          {releaseNotes.length > 0 && <>Version: {formatVersion(releaseNotes[0]!.date)} · </>}
          {commitSha && <>Build: {commitSha.slice(0, 7)}</>}
        </p>
      )}
      {releaseNotes.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Changelog</h3>
          {releaseNotes.map((entry) => (
            <div key={entry.date} style={{ marginBottom: 12 }}>
              <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{formatVersion(entry.date)}</p>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                {entry.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
