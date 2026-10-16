import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useTheme } from "../ThemeContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { InfoBanner } from "../components/InfoBanner";
import { api, ApiRequestError } from "../api";

const SIGNOUT_MESSAGES: Record<string, string> = {
  idle: "You were signed out after a period of inactivity. Sign in again to continue.",
  expired: "Your session expired. Sign in again to continue.",
};

/** Read once per page load (not per render) -- the key is removed immediately so a later manual "Sign out" or page refresh never resurfaces a stale message. */
function readAndClearSignoutReason(): string | null {
  try {
    const reason = sessionStorage.getItem("signout-reason");
    sessionStorage.removeItem("signout-reason");
    return reason ? (SIGNOUT_MESSAGES[reason] ?? null) : null;
  } catch {
    return null;
  }
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (resp: { credential: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const GSI_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

function loadGsiScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  const existing = document.querySelector(`script[src="${GSI_SCRIPT_SRC}"]`);
  if (existing) {
    return new Promise((resolve) => existing.addEventListener("load", () => resolve()));
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GSI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services script."));
    document.head.appendChild(script);
  });
}

function GoogleSignInButton({ clientId, onError }: { clientId: string; onError: (message: string) => void }) {
  const { loginWithGoogle } = useAuth();
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadGsiScript()
      .then(() => {
        if (cancelled || !window.google || !buttonRef.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (resp) => {
            try {
              await loginWithGoogle(resp.credential);
            } catch (err) {
              console.error(err);
              if (err instanceof ApiRequestError && err.body.error === "ACCOUNT_NOT_PROVISIONED") {
                onError("Your Google account isn't set up yet — ask an admin to add you.");
              } else {
                onError(err instanceof ApiRequestError ? err.body.message : "Google sign-in failed.");
              }
            }
          },
        });
        window.google.accounts.id.renderButton(buttonRef.current, { theme: "outline", size: "large", width: 296 });
      })
      .catch(() => onError("Could not load Google sign-in."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  return <div ref={buttonRef} style={{ display: "flex", justifyContent: "center" }} />;
}

/** Only a same-app relative path is accepted as a post-login redirect target -- a bare "/" fallback otherwise, so a malformed or external `state.from` (e.g. a crafted "//evil.com" protocol-relative URL) can never redirect off the app. */
function sanitizeRedirectTarget(from: unknown): string {
  if (typeof from === "string" && from.startsWith("/") && !from.startsWith("//")) return from;
  return "/";
}

export default function LoginPage() {
  const { user, login } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [signoutMessage] = useState(() => readAndClearSignoutReason());

  useEffect(() => {
    api
      .getAuthConfig()
      .then((cfg) => setGoogleClientId(cfg.googleClientId))
      .catch(() => setGoogleClientId(null));
  }, []);

  // RequireAuth (App.tsx) redirects here with state.from set to whatever URL
  // was originally requested -- e.g. a run/batch link opened from an email
  // while signed out -- so a successful sign-in lands back on it instead of
  // always bouncing to the home page.
  const redirectTarget = sanitizeRedirectTarget((location.state as { from?: unknown } | null)?.from);

  if (user) return <Navigate to={redirectTarget} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      console.error(err);
      setError(err instanceof ApiRequestError ? err.body.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="card" style={{ width: 340 }}>
        <div className="brand" style={{ marginBottom: 16 }}>
          <div className="brand-logo">
            <img
              src={theme === "dark" ? "/cozywinters-logo-dark.png" : "/cozywinters-logo-light.png"}
              alt="CozyWinters"
            />
          </div>
          <div className="brand-subtitle">Automated Inventory System</div>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8, marginBottom: 0 }}>
            Update your Miva store's inventory using vendor stock files.
          </p>
        </div>
        {signoutMessage && !error && <InfoBanner message={signoutMessage} />}
        {error && <ErrorBanner message={error} />}

        {googleClientId && (
          <>
            <GoogleSignInButton clientId={googleClientId} onError={setError} />
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0", color: "var(--muted-2)", fontSize: 12 }}>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              or
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>
          </>
        )}

        <form onSubmit={submit}>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Sign in with your email and password.</p>
          <div style={{ marginBottom: 12 }}>
            <label>
              Email
              <br />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} required />
            </label>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label>
              Password
              <br />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: "100%" }}
                required
              />
            </label>
          </div>
          <button className="primary" type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 16, marginBottom: 0, textAlign: "center" }}>
          New here? Ask an admin to create your account.
        </p>
      </div>
    </div>
  );
}
