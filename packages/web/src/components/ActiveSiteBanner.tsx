import { Link } from "react-router-dom";
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
// Fixed hex values, deliberately NOT theme-adaptive tokens like --charcoal:
// --charcoal flips to a *light* gray in dark mode (see styles.css's dark
// :root block), which made an earlier version of this banner nearly
// unreadable (white text on light gray) -- caught via a dark-mode
// screenshot check.
const LIVE_BG = "#16a34a";
const DEV_BG = "#dc2626";

export function ActiveSiteBanner({
  activeSite,
  isAdmin,
}: {
  activeSite: "development" | "live" | null;
  isAdmin: boolean;
}) {
  if (!activeSite) return null;
  const live = activeSite === "live";
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        // Right padding clears the fixed theme-toggle button (top:16/right:24,
        // 36px wide) that floats above this banner in the top-right corner of
        // the viewport in both light and dark mode -- without it, "Switch
        // connection" (flush right via marginLeft: auto below) sits underneath
        // the button and becomes unclickable/unreadable.
        padding: "10px 72px 10px 16px",
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
      {isAdmin && (
        <Link
          to="/settings/miva-connection"
          style={{
            marginLeft: "auto",
            flex: "none",
            color: "#ffffff",
            fontWeight: 600,
            fontSize: 13,
            textDecoration: "underline",
          }}
        >
          Switch connection
        </Link>
      )}
    </div>
  );
}
