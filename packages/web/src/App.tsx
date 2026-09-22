import { Routes, Route, Navigate, NavLink, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
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

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
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
            <img src="/cozywinters-logo-light.png" alt="CozyWinters" />
          </div>
          <div className="brand-subtitle">Automated Inventory System</div>
        </div>
        <nav>
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/runs" className={() => (runHistoryActive ? "active" : "")}>
            Run History
          </NavLink>
          <NavLink to="/catalog">Miva Catalog</NavLink>
          <NavLink to="/audits">Audits &amp; Reviews</NavLink>
          {user?.role === "admin" && <NavLink to="/settings">Settings</NavLink>}
        </nav>
        <div style={{ marginTop: 32, fontSize: 12, color: "#64748b" }}>
          <div>{user?.email}</div>
          <button style={{ marginTop: 8 }} onClick={() => logout()}>
            Sign out
          </button>
        </div>
      </aside>
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
  );
}
