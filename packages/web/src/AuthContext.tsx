import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

export interface AuthUser {
  id: string;
  email: string;
  role: "admin" | "member";
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  /** `reason` is stashed in sessionStorage for LoginPage to surface a one-line explanation (e.g. "signed out for inactivity") -- omitted for a normal, explicit "Sign out" click. */
  logout: (reason?: "idle") => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Fired by api.ts's request() whenever a background API call discovers the
  // session cookie has already expired/been destroyed server-side (12h fixed
  // lifetime, or an idle-timeout logout from another tab) -- without this,
  // `user` would stay set and the UI would look "logged in" but stop working
  // until a manual refresh. Clearing it here lets RequireAuth (App.tsx)
  // redirect to /login immediately, same as any other sign-out.
  useEffect(() => {
    function onSessionExpired() {
      try {
        sessionStorage.setItem("signout-reason", "expired");
      } catch {
        // Private-browsing or storage-disabled -- sign-out still happens, just without the login-page message.
      }
      setUser(null);
    }
    window.addEventListener("session-expired", onSessionExpired);
    return () => window.removeEventListener("session-expired", onSessionExpired);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const u = await api.login(email, password);
    setUser(u);
  }, []);

  const loginWithGoogle = useCallback(async (credential: string) => {
    const u = await api.loginWithGoogle(credential);
    setUser(u);
  }, []);

  const logout = useCallback(async (reason?: "idle") => {
    try {
      if (reason) sessionStorage.setItem("signout-reason", reason);
      else sessionStorage.removeItem("signout-reason");
    } catch {
      // Private-browsing or storage-disabled -- sign-out still happens, just without the login-page message.
    }
    await api.logout();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
