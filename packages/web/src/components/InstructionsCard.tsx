import { useState } from "react";

function storageKeyFor(pageKey: string): string {
  return `cw-instructions-collapsed-${pageKey}`;
}

function loadCollapsed(pageKey: string): boolean {
  try {
    return localStorage.getItem(storageKeyFor(pageKey)) === "1";
  } catch {
    return false;
  }
}

function saveCollapsed(pageKey: string, collapsed: boolean) {
  try {
    localStorage.setItem(storageKeyFor(pageKey), collapsed ? "1" : "0");
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
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(pageKey));

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      saveCollapsed(pageKey, next);
      return next;
    });
  }

  if (collapsed) {
    return (
      <button type="button" className="card intro-card intro-collapsed" onClick={toggle}>
        ▸ Instructions
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
          ▾ Hide
        </button>
      </div>
    </div>
  );
}
