import { AlertTriangle, FlaskConical } from "lucide-react";

/**
 * Top-of-page, every-page banner naming which Miva site (Development or
 * Live) every action on this page actually hits. Added after a real
 * incident: the only existing indicator was a small pill at the bottom of
 * the sidebar, easy to miss entirely -- someone ran a catalog pull, saw a
 * drastically different record count than expected, and didn't realize
 * until after the fact that they were looking at the other site. Rendered
 * unconditionally (never collapsible/dismissible) so it can't be missed or
 * tuned out -- Shell remounts on every navigation anyway, so a dismiss
 * wouldn't persist across pages even if one existed.
 */
// Fixed hex values, deliberately NOT the theme-adaptive --red/--charcoal
// tokens: --charcoal flips to a *light* gray in dark mode (see styles.css's
// dark :root block), which made the Development banner nearly unreadable
// (white text on light gray) -- caught via a dark-mode screenshot check.
// Same pairing as the batch-push email's siteBanner() in
// batchReportTemplate.ts, so the color language for "which Miva site" stays
// consistent across the email and the app itself, in both themes.
const LIVE_BG = "#dc2626";
const DEV_BG = "#334155";

export function ActiveSiteBanner({ activeSite }: { activeSite: "development" | "live" | null }) {
  if (!activeSite) return null;
  const live = activeSite === "live";
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderRadius: "var(--radius-md)",
        marginBottom: 16,
        background: live ? LIVE_BG : DEV_BG,
        color: "#ffffff",
      }}
    >
      {live ? <AlertTriangle size={18} style={{ flex: "none" }} /> : <FlaskConical size={18} style={{ flex: "none" }} />}
      <span style={{ fontWeight: 700, fontSize: 14 }}>
        {live ? "LIVE STORE" : "Development Store"}
        <span style={{ fontWeight: 400, opacity: 0.9 }}>
          {" -- "}
          {live
            ? "every action on this page affects the real, customer-facing Miva site."
            : "this is the test site, not customer-facing."}
        </span>
      </span>
    </div>
  );
}
