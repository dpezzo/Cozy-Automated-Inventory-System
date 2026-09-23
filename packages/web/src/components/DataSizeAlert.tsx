import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronRight, ChevronUp } from "lucide-react";
import { useAuth } from "../AuthContext";
import { api, type DataStats } from "../api";
import { formatBytes } from "../lib/format";

/**
 * Global, every-page banner warning that stored data has crossed the
 * admin-configured size threshold (Settings > Clear Data). Collapsible for
 * the current view, but re-checks and re-expands on every page load/nav
 * (Shell remounts per route) since it's meant to stay visible until an
 * admin actually clears data, not to be dismissed once and forgotten.
 */
export function DataSizeAlert() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DataStats | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    api.getDataStats().then(setStats).catch(() => undefined);
  }, []);

  if (!stats) return null;
  const overThreshold =
    stats.reconciliationRows >= stats.thresholds.reconciliationRows || stats.totalFileBytes >= stats.thresholds.totalFileBytes;
  if (!overThreshold) return null;

  if (collapsed) {
    return (
      <button type="button" className="card size-alert-card size-alert-collapsed" onClick={() => setCollapsed(false)}>
        <AlertTriangle size={16} /> Storage alert <ChevronRight size={14} />
      </button>
    );
  }

  const isAdmin = user?.role === "admin";

  return (
    <div className="card size-alert-card">
      <div className="intro-header">
        <div>
          <p className="intro-description" style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <AlertTriangle size={16} style={{ flex: "none", marginTop: 2 }} />
            <span>
              This deployment's stored data is getting large -- {stats.reconciliationRows.toLocaleString()} reconciliation rows,{" "}
            {formatBytes(stats.totalFileBytes)} of files.{" "}
            {isAdmin ? (
              <Link to="/settings/clear-data">Clear old data in Settings →</Link>
            ) : (
              "Ask an admin to clear old data from Settings."
            )}
            </span>
          </p>
        </div>
        <button type="button" className="intro-toggle" onClick={() => setCollapsed(true)}>
          <ChevronUp size={14} /> Hide
        </button>
      </div>
    </div>
  );
}
