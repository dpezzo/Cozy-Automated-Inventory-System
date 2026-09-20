import { Link } from "react-router-dom";
import { InstructionsCard } from "../components/InstructionsCard";

export default function SettingsPage() {
  return (
    <div>
      <h2>Settings</h2>
      <InstructionsCard pageKey="settings" description="Admin-only tools for managing users, vendors, and stored data." />
      <div className="grid cols-2">
        <Link to="/settings/users" className="card settings-tile">
          <h3>Manage Users</h3>
          <p>Add operators and admins, change roles, deactivate accounts.</p>
        </Link>
        <Link to="/settings/vendors" className="card settings-tile">
          <h3>Manage Vendors</h3>
          <p>Configure vendor file shapes, column mappings, and matching rules.</p>
        </Link>
        <Link to="/settings/clear-data" className="card settings-tile">
          <h3>Clear Data</h3>
          <p>Permanently delete old runs, batches, and their files to free up space, or reset for a fresh install.</p>
        </Link>
      </div>
    </div>
  );
}
