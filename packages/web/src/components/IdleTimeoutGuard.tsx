import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../AuthContext";
import { api } from "../api";

/** How long the "you're about to be signed out" warning stays up before logging out, once it appears. */
const WARNING_SECONDS = 60;
/** Once the warning is showing, only an explicit "Stay signed in" click resets the timer -- these events no longer count, so idly moving the mouse near the warning can't silently dismiss it. */
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;

/**
 * Renders nothing while the user is active. After idleTimeoutMinutes minus
 * WARNING_SECONDS of inactivity, shows a countdown warning; if it's not
 * dismissed before it reaches zero, signs the user out (destroying the
 * server session via logout(), not just clearing client state) so a
 * forgotten, unattended browser tab doesn't stay signed in indefinitely.
 * Mounted once inside Shell (App.tsx), so it only runs for an authenticated
 * session.
 */
export function IdleTimeoutGuard() {
  const { user, logout } = useAuth();
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState<number | null>(null);
  const [warningSecondsLeft, setWarningSecondsLeft] = useState<number | null>(null);
  const lastActivityRef = useRef(Date.now());
  const warningActiveRef = useRef(false);
  const loggingOutRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    api
      .getSessionConfig()
      .then((c) => setIdleTimeoutMinutes(c.idleTimeoutMinutes))
      .catch(() => setIdleTimeoutMinutes(30)); // fail open to a sane default rather than never timing out
  }, [user]);

  const recordActivity = useCallback(() => {
    if (warningActiveRef.current) return;
    lastActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!user) return;
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, recordActivity, { passive: true });
    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, recordActivity);
    };
  }, [user, recordActivity]);

  useEffect(() => {
    if (!user || idleTimeoutMinutes === null) return;
    lastActivityRef.current = Date.now();
    warningActiveRef.current = false;
    loggingOutRef.current = false;
    setWarningSecondsLeft(null);

    const idleTimeoutMs = idleTimeoutMinutes * 60_000;
    const tick = setInterval(() => {
      if (loggingOutRef.current) return;
      // Wall-clock elapsed time, not a tick count -- self-corrects even if
      // the browser throttled this interval while the tab was backgrounded.
      const elapsed = Date.now() - lastActivityRef.current;
      if (!warningActiveRef.current) {
        if (elapsed >= idleTimeoutMs - WARNING_SECONDS * 1000) {
          warningActiveRef.current = true;
          setWarningSecondsLeft(WARNING_SECONDS);
        }
        return;
      }
      const remaining = Math.ceil((idleTimeoutMs - elapsed) / 1000);
      if (remaining <= 0) {
        loggingOutRef.current = true;
        void logout("idle");
      } else {
        setWarningSecondsLeft(remaining);
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [user, idleTimeoutMinutes, logout]);

  function stayLoggedIn() {
    warningActiveRef.current = false;
    lastActivityRef.current = Date.now();
    setWarningSecondsLeft(null);
  }

  if (!user || warningSecondsLeft === null) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Session timeout warning"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
      }}
    >
      <div className="card" style={{ width: 380, margin: 0 }}>
        <h3 style={{ marginTop: 0 }}>Still there?</h3>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          You've been inactive for a while. For security, you'll be signed out in{" "}
          <strong style={{ color: "var(--text)" }}>
            {warningSecondsLeft} second{warningSecondsLeft === 1 ? "" : "s"}
          </strong>{" "}
          unless you stay signed in.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="primary" onClick={stayLoggedIn} autoFocus>
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
