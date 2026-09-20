import { Fragment, useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { api, ApiRequestError, type VendorConfig, type CreateVendorInput } from "../api";

function parseAllowlist(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Inline edit form for any vendor, any file_shape. columnMapping fields only show for simple_csv vendors. */
function EditVendorForm({ vendor, onDone, onCancel }: { vendor: VendorConfig; onDone: () => void; onCancel: () => void }) {
  const [vendorLabel, setVendorLabel] = useState(vendor.vendorLabel);
  const [inStockThreshold, setInStockThreshold] = useState(String(vendor.inStockThreshold));
  const [timezone, setTimezone] = useState(vendor.timezone);
  const [brandAllowlist, setBrandAllowlist] = useState(vendor.brandAllowlist.join(", "));
  const [matchStrategy, setMatchStrategy] = useState(vendor.matchStrategy);
  const [identifierColumn, setIdentifierColumn] = useState(vendor.columnMapping?.identifierColumn ?? "");
  const [identifierType, setIdentifierType] = useState<"upc" | "sku">(vendor.columnMapping?.identifierType ?? "upc");
  const [descriptionColumn, setDescriptionColumn] = useState(vendor.columnMapping?.descriptionColumn ?? "");
  const [quantityColumn, setQuantityColumn] = useState(vendor.columnMapping?.quantityColumn ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.updateVendor(vendor.vendorKey, {
        vendorLabel,
        inStockThreshold: Number(inStockThreshold),
        timezone,
        brandAllowlist: parseAllowlist(brandAllowlist),
        matchStrategy,
        ...(vendor.fileShape === "simple_csv"
          ? { columnMapping: { identifierColumn, identifierType, descriptionColumn: descriptionColumn || undefined, quantityColumn } }
          : {}),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to update vendor.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
      {error && <div className="error-banner">{error}</div>}
      <div className="grid cols-2">
        <label>
          Vendor label
          <br />
          <input value={vendorLabel} onChange={(e) => setVendorLabel(e.target.value)} style={{ width: "100%" }} required />
        </label>
        <label>
          In-stock threshold
          <br />
          <input
            type="number"
            min={1}
            value={inStockThreshold}
            onChange={(e) => setInStockThreshold(e.target.value)}
            style={{ width: "100%" }}
            required
          />
        </label>
        <label>
          Timezone (IANA)
          <br />
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ width: "100%" }} required />
        </label>
        <label>
          Match strategy
          <br />
          <select value={matchStrategy} onChange={(e) => setMatchStrategy(e.target.value as VendorConfig["matchStrategy"])} style={{ width: "100%" }}>
            <option value="upc-to-gtin">UPC to GTIN</option>
            <option value="sku-to-mpn">SKU to MPN</option>
          </select>
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Brand allowlist (comma-separated)
          <br />
          <input value={brandAllowlist} onChange={(e) => setBrandAllowlist(e.target.value)} style={{ width: "100%" }} required />
        </label>
      </div>

      {vendor.fileShape === "simple_csv" && (
        <div className="grid cols-2" style={{ marginTop: 12 }}>
          <label>
            Identifier column name
            <br />
            <input value={identifierColumn} onChange={(e) => setIdentifierColumn(e.target.value)} style={{ width: "100%" }} required />
          </label>
          <label>
            Identifier type
            <br />
            <select value={identifierType} onChange={(e) => setIdentifierType(e.target.value as "upc" | "sku")} style={{ width: "100%" }}>
              <option value="upc">UPC</option>
              <option value="sku">SKU</option>
            </select>
          </label>
          <label>
            Description column name (optional)
            <br />
            <input value={descriptionColumn} onChange={(e) => setDescriptionColumn(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            Quantity column name
            <br />
            <input value={quantityColumn} onChange={(e) => setQuantityColumn(e.target.value)} style={{ width: "100%" }} required />
          </label>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button className="primary" type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onCancel} style={{ marginLeft: 8 }} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddVendorForm({ pluginFiles, onDone, onReloadPlugins }: { pluginFiles: string[]; onDone: () => void; onReloadPlugins: () => void }) {
  const [mode, setMode] = useState<"simple_csv" | "plugin">("simple_csv");
  const [vendorKey, setVendorKey] = useState("");
  const [vendorLabel, setVendorLabel] = useState("");
  const [inStockThreshold, setInStockThreshold] = useState("6");
  const [timezone, setTimezone] = useState("America/New_York");
  const [brandAllowlist, setBrandAllowlist] = useState("");
  const [matchStrategy, setMatchStrategy] = useState<"upc-to-gtin" | "sku-to-mpn">("upc-to-gtin");
  const [identifierColumn, setIdentifierColumn] = useState("");
  const [identifierType, setIdentifierType] = useState<"upc" | "sku">("upc");
  const [descriptionColumn, setDescriptionColumn] = useState("");
  const [quantityColumn, setQuantityColumn] = useState("");
  const [pluginFilename, setPluginFilename] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const common = {
        vendorKey,
        vendorLabel,
        inStockThreshold: Number(inStockThreshold),
        timezone,
        brandAllowlist: parseAllowlist(brandAllowlist),
        matchStrategy,
      };
      const input: CreateVendorInput =
        mode === "simple_csv"
          ? {
              ...common,
              fileShape: "simple_csv",
              columnMapping: { identifierColumn, identifierType, descriptionColumn: descriptionColumn || undefined, quantityColumn },
            }
          : { ...common, fileShape: "plugin", pluginFilename };
      await api.createVendor(input);
      setVendorKey("");
      setVendorLabel("");
      setInStockThreshold("6");
      setBrandAllowlist("");
      setIdentifierColumn("");
      setDescriptionColumn("");
      setQuantityColumn("");
      setPluginFilename("");
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to create vendor.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="error-banner">{error}</div>}
      <div style={{ marginBottom: 12 }}>
        <button type="button" className={mode === "simple_csv" ? "active" : ""} onClick={() => setMode("simple_csv")}>
          Simple CSV
        </button>
        <button type="button" className={mode === "plugin" ? "active" : ""} onClick={() => setMode("plugin")} style={{ marginLeft: 8 }}>
          Register parser file
        </button>
      </div>

      <div className="grid cols-2">
        <label>
          Vendor key (immutable, e.g. "acme-co")
          <br />
          <input
            value={vendorKey}
            onChange={(e) => setVendorKey(e.target.value)}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="lowercase letters, numbers, and hyphens only"
            style={{ width: "100%" }}
            required
          />
        </label>
        <label>
          Vendor label
          <br />
          <input value={vendorLabel} onChange={(e) => setVendorLabel(e.target.value)} style={{ width: "100%" }} required />
        </label>
        <label>
          In-stock threshold
          <br />
          <input type="number" min={1} value={inStockThreshold} onChange={(e) => setInStockThreshold(e.target.value)} style={{ width: "100%" }} required />
        </label>
        <label>
          Timezone (IANA)
          <br />
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ width: "100%" }} required />
        </label>
        <label>
          Match strategy
          <br />
          <select value={matchStrategy} onChange={(e) => setMatchStrategy(e.target.value as "upc-to-gtin" | "sku-to-mpn")} style={{ width: "100%" }}>
            <option value="upc-to-gtin">UPC to GTIN</option>
            <option value="sku-to-mpn">SKU to MPN</option>
          </select>
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Brand allowlist (comma-separated)
          <br />
          <input value={brandAllowlist} onChange={(e) => setBrandAllowlist(e.target.value)} style={{ width: "100%" }} required />
        </label>
      </div>

      {mode === "simple_csv" ? (
        <div className="grid cols-2" style={{ marginTop: 12 }}>
          <label>
            Identifier column name
            <br />
            <input value={identifierColumn} onChange={(e) => setIdentifierColumn(e.target.value)} style={{ width: "100%" }} required />
          </label>
          <label>
            Identifier type
            <br />
            <select value={identifierType} onChange={(e) => setIdentifierType(e.target.value as "upc" | "sku")} style={{ width: "100%" }}>
              <option value="upc">UPC</option>
              <option value="sku">SKU</option>
            </select>
          </label>
          <label>
            Description column name (optional)
            <br />
            <input value={descriptionColumn} onChange={(e) => setDescriptionColumn(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            Quantity column name
            <br />
            <input value={quantityColumn} onChange={(e) => setQuantityColumn(e.target.value)} style={{ width: "100%" }} required />
          </label>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13, color: "#64748b" }}>
            Plugin files are placed directly on the server's filesystem (under the vendor plugins folder) by a developer or admin --
            this form only registers and configures an already-present file, it never uploads code.
          </p>
          <label>
            Parser file
            <br />
            <select value={pluginFilename} onChange={(e) => setPluginFilename(e.target.value)} style={{ width: "100%" }} required>
              <option value="">Select a file...</option>
              {pluginFiles.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onReloadPlugins} style={{ marginTop: 8 }}>
            Reload plugin files
          </button>
        </div>
      )}

      <button className="primary" type="submit" disabled={creating} style={{ marginTop: 16 }}>
        {creating ? "Adding..." : "Add vendor"}
      </button>
    </form>
  );
}

export default function ManageVendorsPage() {
  const { user } = useAuth();
  const [vendors, setVendors] = useState<VendorConfig[]>([]);
  const [pluginFiles, setPluginFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function refresh() {
    setLoading(true);
    Promise.all([api.listVendors(), api.listAvailablePluginFiles()])
      .then(([v, p]) => {
        setVendors(v);
        setPluginFiles(p);
      })
      .catch((err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to load vendors."))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, []);

  async function reloadPlugins() {
    setError(null);
    try {
      await api.reloadPlugins();
      const p = await api.listAvailablePluginFiles();
      setPluginFiles(p);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to reload plugins.");
    }
  }

  // Deactivation is soft and one-way from this UI (DELETE /vendors/:key sets
  // is_active = false) -- there is no reactivate route, matching the backend
  // spec (a deactivated vendor is expected to be re-created or restored by a
  // developer, not casually flipped back on).
  async function deactivate(v: VendorConfig) {
    setBusyKey(v.vendorKey);
    setError(null);
    try {
      await api.deleteVendor(v.vendorKey);
      refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to deactivate vendor.");
    } finally {
      setBusyKey(null);
    }
  }

  if (user?.role !== "admin") {
    return <div>Admin access required.</div>;
  }

  return (
    <div>
      <h2>Manage Vendors</h2>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <h3>Vendors</h3>
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Match strategy</th>
              <th>Threshold</th>
              <th>Brands</th>
              <th>File shape</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7}>Loading...</td>
              </tr>
            )}
            {!loading && vendors.length === 0 && (
              <tr>
                <td colSpan={7}>No vendors yet.</td>
              </tr>
            )}
            {vendors.map((v) => (
              <Fragment key={v.vendorKey}>
                <tr>
                  <td>{v.vendorLabel}</td>
                  <td>{v.matchStrategy}</td>
                  <td>{v.inStockThreshold}</td>
                  <td>{v.brandAllowlist.length}</td>
                  <td>{v.fileShape}</td>
                  <td>
                    <span
                      style={{
                        fontSize: 12,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: v.isActive ? "#dcfce7" : "#f1f5f9",
                        color: v.isActive ? "#166534" : "#64748b",
                      }}
                    >
                      {v.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => setEditingKey(editingKey === v.vendorKey ? null : v.vendorKey)}>
                      {editingKey === v.vendorKey ? "Close" : "Edit"}
                    </button>
                    {v.isActive && (
                      <button className="danger" disabled={busyKey === v.vendorKey} onClick={() => deactivate(v)} style={{ marginLeft: 8 }}>
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
                {editingKey === v.vendorKey && (
                  <tr>
                    <td colSpan={7}>
                      <EditVendorForm
                        vendor={v}
                        onDone={() => {
                          setEditingKey(null);
                          refresh();
                        }}
                        onCancel={() => setEditingKey(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Add vendor</h3>
        <AddVendorForm pluginFiles={pluginFiles} onDone={refresh} onReloadPlugins={reloadPlugins} />
      </div>
    </div>
  );
}
