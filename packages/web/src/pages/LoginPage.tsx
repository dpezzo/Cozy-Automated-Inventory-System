import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { ApiRequestError } from "../api";

export default function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="card" style={{ width: 340 }} onSubmit={submit}>
        <div className="brand" style={{ marginBottom: 16 }}>
          <div className="brand-logo">
            <img src="/cozywinters-logo-light.png" alt="CozyWinters" />
          </div>
          <div className="brand-subtitle">Automated Inventory System</div>
        </div>
        <p style={{ color: "#64748b", fontSize: 13 }}>Sign in with the pre-authorized administrator account.</p>
        {error && <div className="error-banner">{error}</div>}
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
    </div>
  );
}
