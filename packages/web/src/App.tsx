import { useState } from "react";
import { Routes, Route, Navigate, NavLink, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import { ThemeProvider, useTheme } from "./ThemeContext";
import { HomeLabelProvider, useHomeLabel } from "./HomeLabelContext";
import { Glossary } from "./components/Glossary";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import RunReviewPage from "./pages/RunReviewPage";
import RunHistoryPage from "./pages/RunHistoryPage";
import BatchDetailPage from "./pages/BatchDetailPage";
import CatalogPage from "./pages/CatalogPage";
import AuditsReviewsPage from "./pages/AuditsReviewsPage";
import ManageUsersPage from "./pages/ManageUsersPage";
import ManageVendorsPage from "./pages/ManageVendorsPage";
import SettingsPage from "./pages/SettingsPage";
import ClearDataPage from "./pages/ClearDataPage";
import { DataSizeAlert } from "./components/DataSizeAlert";
import { Sun, Moon, Home, RefreshCcw, History, Layers, ClipboardCheck, Settings, HelpCircle } from "lucide-react";

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { homeLabel } = useHomeLabel();
  const location = useLocation();
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  // A run's review page (/runs/:runId) and a batch's detail page
  // (/batches/:batchId) are both reached either from Home (start a new
  // reconciliation) or from Run History (open an existing row) -- but
  // either way they're drill-down views of a run or the batch it produced,
  // so "Run History" is the section that owns them regardless of which
  // page you clicked in from. NavLink's own prefix matching only covers
  // /runs/*, not /batches/*, hence the explicit check here.
  const runHistoryActive = location.pathname.startsWith("/runs") || location.pathname.startsWith("/batches");
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <img
              src={theme === "dark" ? "/cozywinters-logo-dark.png" : "/cozywinters-logo-light.png"}
              alt="CozyWinters"
            />
          </div>
          <div className="brand-subtitle">Automated Inventory System</div>
        </div>
        <nav>
          <NavLink to="/" end>
            {homeLabel === "Run Reconciliation" ? (
              <RefreshCcw size={19} strokeWidth={2.5} />
            ) : (
              <Home size={19} strokeWidth={2.5} />
            )}{" "}
            {homeLabel}
          </NavLink>
          <NavLink to="/runs" className={() => (runHistoryActive ? "active" : "")}>
            <History size={19} strokeWidth={2.5} /> Run History
          </NavLink>
          <NavLink to="/catalog">
            <Layers size={19} strokeWidth={2.5} /> Miva Catalog
          </NavLink>
          <NavLink to="/audits">
            <ClipboardCheck size={19} strokeWidth={2.5} /> Audits &amp; Reviews
          </NavLink>
          {user?.role === "admin" && (
            <NavLink to="/settings">
              <Settings size={19} strokeWidth={2.5} /> Settings
            </NavLink>
          )}
        </nav>
        <div style={{ marginTop: 32, fontSize: 12, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ flex: 1 }} onClick={() => logout()}>
              Sign out
            </button>
            <button onClick={() => setGlossaryOpen(true)} title="Glossary of terms used in this app">
              <HelpCircle size={16} />
            </button>
          </div>
        </div>
      </aside>
      {glossaryOpen && <Glossary onClose={() => setGlossaryOpen(false)} />}
      <button
        className="theme-toggle-corner"
        onClick={toggleTheme}
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <main className="main">
        <DataSizeAlert />
        {children}
      </main>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40 }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  return (
    <ThemeProvider>
    <HomeLabelProvider>
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <HomePage />
            </RequireAuth>
          }
        />
        <Route
          path="/runs"
          element={
            <RequireAuth>
              <RunHistoryPage />
            </RequireAuth>
          }
        />
        <Route
          path="/runs/:runId"
          element={
            <RequireAuth>
              <RunReviewPage />
            </RequireAuth>
          }
        />
        <Route
          path="/catalog"
          element={
            <RequireAuth>
              <CatalogPage />
            </RequireAuth>
          }
        />
        <Route
          path="/audits"
          element={
            <RequireAuth>
              <AuditsReviewsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <SettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings/users"
          element={
            <RequireAuth>
              <ManageUsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings/vendors"
          element={
            <RequireAuth>
              <ManageVendorsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings/clear-data"
          element={
            <RequireAuth>
              <ClearDataPage />
            </RequireAuth>
          }
        />
        <Route
          path="/batches/:batchId"
          element={
            <RequireAuth>
              <BatchDetailPage />
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
    </HomeLabelProvider>
    </ThemeProvider>
  );
}
