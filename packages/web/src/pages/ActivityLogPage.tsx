import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Inbox } from "lucide-react";
import { api, type AuditLogRecord } from "../api";
import { InstructionsCard } from "../components/InstructionsCard";

/** Turns a raw SNAKE_CASE constant (e.g. an activity-log action or entity type) into readable text -- "RUN_CREATED" -> "Run created". Not a curated per-value map since new action types get added on the server over time; this keeps every value at least readable without needing to keep a list in sync. */
function humanize(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Admin-only browser for the audit_log table -- every RUN_CREATED, BATCH_GENERATED, LEGACY_COMPARISON_RUN, VENDOR_CONFIG_*, USER_* etc. event the app already records. Its own page (reached from Settings) rather than a tab on Audits & Reviews, since the two were getting confused for each other. */
export default function ActivityLogPage() {
  const [entries, setEntries] = useState<AuditLogRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listAuditLog().then((rows) => {
      setEntries(rows);
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    if (!search) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (e) =>
        e.action.toLowerCase().includes(q) ||
        e.entityType.toLowerCase().includes(q) ||
        (e.actorEmail ?? "").toLowerCase().includes(q),
    );
  }, [entries, search]);

  // Fills the rest of the viewport below the table instead of a fixed
  // maxHeight, so it adapts to the monitor size and to whatever's above it
  // changing height (e.g. the instructions card being expanded/collapsed) --
  // same technique as Run History's tables and the Miva Catalog table.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tableHeight, setTableHeight] = useState(400);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function recompute() {
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      // 64px = the enclosing .card's own bottom padding + margin (20 + 20) plus .main's bottom padding (24).
      setTableHeight(Math.max(200, window.innerHeight - top - 64));
    }
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(document.body);
    window.addEventListener("resize", recompute);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, []);

  return (
    <div>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Activity size={24} strokeWidth={2.25} /> Activity Log
      </h2>
      <InstructionsCard
        pageKey="activity-log"
        description="Every significant action recorded across the app -- runs, batches, vendor/user changes, and more."
      />
      <div className="card">
        <Link to="/settings">Back to settings</Link>
      </div>
      <div className="card">
        <div className="filters">
          <input
            type="text"
            placeholder="Search by action, entity type, or user"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 320 }}
          />
          <span style={{ marginLeft: "auto", color: "var(--muted)" }}>
            Showing {filtered.length} of {entries.length} most recent event{entries.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="table-scroll" ref={scrollRef} style={{ height: tableHeight, maxHeight: tableHeight }}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.createdAt).toLocaleString()}</td>
                  <td>{e.actorEmail ?? "—"}</td>
                  <td title={e.action}>{humanize(e.action)}</td>
                  <td title={e.entityId ?? e.entityType}>{humanize(e.entityType)}</td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>
                    {Object.keys(e.details).length > 0 ? JSON.stringify(e.details) : "-"}
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: "var(--muted)" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Inbox size={16} /> No activity recorded yet.
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
