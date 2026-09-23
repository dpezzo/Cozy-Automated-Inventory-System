import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, UserPlus, CheckCircle2, XCircle, Pencil, UserX, UserCheck } from "lucide-react";
import { useAuth } from "../AuthContext";
import { api, ApiRequestError, type UserAccount } from "../api";
import { InstructionsCard } from "../components/InstructionsCard";
import { ErrorBanner } from "../components/ErrorBanner";

export default function ManageUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "member">("member");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  function refresh() {
    setLoading(true);
    api
      .listUsers()
      .then(setUsers)
      .catch((err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to load users."))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, []);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await api.createUser({
        email: newEmail,
        role: newRole,
        displayName: newDisplayName || undefined,
        password: newPassword || undefined,
      });
      setNewEmail("");
      setNewDisplayName("");
      setNewRole("member");
      setNewPassword("");
      setShowAddUser(false);
      refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to create user.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(u: UserAccount) {
    if (u.isActive && !window.confirm(`Deactivate ${u.email}? They will immediately lose access.`)) return;
    setBusyId(u.id);
    setError(null);
    try {
      await api.updateUser(u.id, { isActive: !u.isActive });
      refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to update user.");
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(u: UserAccount, role: "admin" | "member") {
    setBusyId(u.id);
    setError(null);
    try {
      await api.updateUser(u.id, { role });
      refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to update user.");
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(u: UserAccount) {
    setEditingId(u.id);
    setEditEmail(u.email);
    setEditDisplayName(u.displayName ?? "");
    setEditPassword("");
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(u: UserAccount) {
    setSavingEdit(true);
    setError(null);
    try {
      const patch: Partial<{ email: string; displayName: string | null; password: string }> = {};
      const trimmedEmail = editEmail.trim().toLowerCase();
      if (trimmedEmail !== u.email) patch.email = trimmedEmail;
      const trimmedName = editDisplayName.trim();
      if (trimmedName !== (u.displayName ?? "")) patch.displayName = trimmedName || null;
      if (editPassword) patch.password = editPassword;
      if (Object.keys(patch).length > 0) {
        await api.updateUser(u.id, patch);
        refresh();
      }
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to update user.");
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <Link to="/settings" style={{ fontSize: 13 }}>
          ← Settings
        </Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Users size={20} /> Manage Users
        </h2>
        {!showAddUser && (
          <button className="primary" onClick={() => setShowAddUser(true)}>
            <UserPlus size={16} /> Add user
          </button>
        )}
      </div>
      <InstructionsCard
        pageKey="manage-users"
        description="Add operators and admins, change roles, and deactivate accounts."
        steps={[
          "Click + Add user to invite someone new.",
          "Click Edit to change a user's email, display name, or password.",
          "Change a user's role or deactivate their account from the table below.",
        ]}
      />
      {error && <ErrorBanner message={error} />}

      <div className="card">
        <h3>Users</h3>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Display name</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5}>Loading...</td>
              </tr>
            )}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={5}>No users yet.</td>
              </tr>
            )}
            {users.map((u) => {
              const isSelf = u.id === currentUser?.id;
              return (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.displayName ?? "-"}</td>
                  <td>
                    <select
                      value={u.role}
                      disabled={isSelf || busyId === u.id}
                      onChange={(e) => changeRole(u, e.target.value as "admin" | "member")}
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  </td>
                  <td>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: u.isActive ? "var(--green-soft)" : "var(--panel-2)",
                        color: u.isActive ? "var(--green)" : "var(--muted)",
                      }}
                    >
                      {u.isActive ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      {u.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <button
                      disabled={busyId === u.id || editingId === u.id}
                      onClick={() => startEdit(u)}
                    >
                      <Pencil size={14} /> Edit
                    </button>{" "}
                    <button
                      className={u.isActive ? "danger" : ""}
                      disabled={isSelf || busyId === u.id}
                      onClick={() => toggleActive(u)}
                      title={isSelf ? "You cannot deactivate your own account" : undefined}
                    >
                      {u.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                      {u.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {editingId &&
              (() => {
                const u = users.find((x) => x.id === editingId);
                if (!u) return null;
                return (
                  <tr key={`${u.id}-edit`}>
                    <td colSpan={5}>
                      <div className="grid cols-2" style={{ margin: "8px 0" }}>
                        <label>
                          Email
                          <br />
                          <input
                            type="email"
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            style={{ width: "100%" }}
                          />
                        </label>
                        <label>
                          Display name
                          <br />
                          <input
                            type="text"
                            value={editDisplayName}
                            onChange={(e) => setEditDisplayName(e.target.value)}
                            style={{ width: "100%" }}
                          />
                        </label>
                        <label>
                          New password
                          <br />
                          <input
                            type="password"
                            value={editPassword}
                            onChange={(e) => setEditPassword(e.target.value)}
                            style={{ width: "100%" }}
                            placeholder="Leave blank to keep current password"
                          />
                        </label>
                      </div>
                      <button className="primary" onClick={() => saveEdit(u)} disabled={savingEdit}>
                        {savingEdit ? "Saving..." : "Save"}
                      </button>{" "}
                      <button onClick={cancelEdit} disabled={savingEdit}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                );
              })()}
          </tbody>
        </table>
      </div>

      {showAddUser && (
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3>Add user</h3>
          <button onClick={() => setShowAddUser(false)}>Cancel</button>
        </div>
        <form onSubmit={submitCreate}>
          <div className="grid cols-2">
            <label>
              Email
              <br />
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                style={{ width: "100%" }}
                required
              />
            </label>
            <label>
              Display name
              <br />
              <input
                type="text"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              Role
              <br />
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as "admin" | "member")} style={{ width: "100%" }}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label>
              Initial password (optional)
              <br />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={{ width: "100%" }}
                placeholder="Leave blank for Google sign-in only"
              />
            </label>
          </div>
          <button className="primary" type="submit" disabled={creating} style={{ marginTop: 16 }}>
            {creating ? "Adding..." : "Add user"}
          </button>
        </form>
      </div>
      )}
    </div>
  );
}
