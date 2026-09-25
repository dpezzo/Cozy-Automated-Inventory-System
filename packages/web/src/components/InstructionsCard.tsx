import { useEffect, useState } from "react";
import { Info, ChevronRight, ChevronUp } from "lucide-react";
import { useAuth } from "../AuthContext";

/** Keyed per user (not just per page) so one person collapsing this on a shared/kiosk machine doesn't hide it from the next person who signs in there -- including a brand-new hire. */
function storageKeyFor(pageKey: string, userId: string | undefined): string {
  return `cw-instructions-collapsed-${pageKey}-${userId ?? "anon"}`;
}

function loadCollapsed(pageKey: string, userId: string | undefined): boolean {
  try {
    return localStorage.getItem(storageKeyFor(pageKey, userId)) === "1";
  } catch {
    return false;
  }
}

function saveCollapsed(pageKey: string, userId: string | undefined, collapsed: boolean) {
  try {
    localStorage.setItem(storageKeyFor(pageKey, userId), collapsed ? "1" : "0");
  } catch {
    // per-viewer convenience only -- fine to silently skip if storage is unavailable
  }
}

/**
 * A short "how this page works" banner -- an optional intro line plus a
 * numbered walkthrough, for pages built around a fixed sequence of steps.
 * Collapsible, remembered per page (per browser) via localStorage so it
 * doesn't take up space once you already know how the page works.
 */
export function InstructionsCard({ pageKey, description, steps }: { pageKey: string; description?: string; steps?: string[] }) {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(pageKey, user?.id));

  // Several pages (Catalog, Audits, Run History, Run Review) size a table to
  // fill the rest of the viewport below whatever's above it, recomputed on a
  // "resize" listener -- but toggling this card changes that layout without
  // resizing the window, and .app-shell's own min-height: 100vh usually keeps
  // document.body from visibly resizing either. Dispatching a synthetic
  // resize event lets those pages' existing listeners pick up the change for
  // free, with no per-page wiring needed.
  useEffect(() => {
    window.dispatchEvent(new Event("resize"));
  }, [collapsed]);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      saveCollapsed(pageKey, user?.id, next);
      return next;
    });
  }

  if (collapsed) {
    return (
      <button type="button" className="card intro-card intro-collapsed" onClick={toggle}>
        <Info size={16} /> Instructions <ChevronRight size={14} />
      </button>
    );
  }

  return (
    <div className="card intro-card">
      <div className="intro-header">
        <div>
          {description && <p className="intro-description">{description}</p>}
          {steps && steps.length > 0 && (
            <ol className="intro-steps">
              {steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          )}
        </div>
        <button type="button" className="intro-toggle" onClick={toggle}>
          <ChevronUp size={14} /> Hide
        </button>
      </div>
    </div>
  );
}
