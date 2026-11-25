import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Truck, Plus, CheckCircle2, XCircle, Pencil, X, Ban, RefreshCw } from "lucide-react";
import { useAuth } from "../AuthContext";
import { api, ApiRequestError, type VendorConfig, type CreateVendorInput } from "../api";
import { InstructionsCard } from "../components/InstructionsCard";
import { ErrorBanner } from "../components/ErrorBanner";

function parseAllowlist(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const MATCH_STRATEGY_LABELS: Record<string, string> = {
  "upc-to-gtin": "UPC to GTIN",
  "sku-to-mpn": "SKU to MPN",
  "upc-or-sku": "Both (UPC + SKU)",
};

const FILE_SHAPE_LABELS: Record<string, string> = {
  simple_csv: "CSV / XLSX",
  plugin: "Custom parser",
  custom: "Custom parser",
};

const MATCH_STRATEGY_HINT =
  "Which vendor-file identifier is matched against which Miva catalog field. Use UPC to GTIN unless the vendor only provides SKUs, not UPCs -- then use SKU to MPN instead. \"Both\" checks UPC and SKU independently on every row (using whichever one resolves, and blocking for review if they disagree) -- use it when the vendor's file reliably provides both and you want the extra cross-check.";
const DISCONTINUED_THRESHOLD_HINT =
  "Optional. A discontinued product with fewer units than this is proposed as No Longer Available; at or above it, the normal in-stock threshold applies so it stays live while real inventory remains. Leave blank to turn this off.";
const SHARED_KEY_HINT =
  "Some products share one SKU/UPC on purpose (e.g. a heated cat bowl and a heated dog bowl listed as two product codes of the same item). Block: such a row is blocked and none of them update. Update all: every product with that identifier is updated with the same quantity, each flagged SHARED_MIVA_KEY for review. Only applies to the UPC to GTIN and SKU to MPN strategies.";
const PARSER_VERSION_HINT =
  "This version is tried first. If a file does not fit it, the other versions are tried automatically and the upload and run show which one was used. Switch back here if the vendor changes its file layout again.";
const IN_STOCK_THRESHOLD_HINT =
  "Minimum vendor quantity to be treated as in-stock. E.g. 6 means any vendor quantity below 6 is treated as out of stock in the proposed Miva update.";
const TIMEZONE_HINT = "Used to determine this vendor's \"business day\" cutoff when comparing file dates. Format: America/New_York, America/Chicago, etc.";

function FieldHint({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, fontWeight: 400 }}>{children}</div>;
}

/**
 * Pop-up window around the edit form so it is clear which vendor is being edited. Escape closes it; clicking the
 * dimmed background deliberately does not, so a stray click never throws away unsaved changes.
 */
function VendorEditModal({ vendor, onClose, children }: { vendor: VendorConfig; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${vendor.vendorLabel}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 16,
      }}
    >
      <div className="card" style={{ width: "min(960px, 100%)", maxHeight: "92vh", overflow: "auto", margin: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h3 style={{ margin: 0 }}>Edit vendor: {vendor.vendorLabel}</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ padding: "4px 8px" }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function splitWords(text: string): string[] {
  return text.split(",").map((w) => w.trim()).filter((w) => w !== "");
}

/** Builds the columnMapping.stockTextValues payload; undefined (numeric quantity column) when both boxes are empty. */
function buildStockText(inStockWords: string, outOfStockWords: string) {
  const inStock = splitWords(inStockWords);
  const outOfStock = splitWords(outOfStockWords);
  return inStock.length === 0 && outOfStock.length === 0 ? undefined : { inStock, outOfStock };
}

/** Optional pair of boxes for vendors whose quantity column holds words ("In Stock") instead of numbers. */
function StockWordsFields({
  inStockWords,
  outOfStockWords,
  setInStockWords,
  setOutOfStockWords,
}: {
  inStockWords: string;
  outOfStockWords: string;
  setInStockWords: (v: string) => void;
  setOutOfStockWords: (v: string) => void;
}) {
  return (
    <>
      <label>
        In-stock words (optional)
        <br />
        <input value={inStockWords} onChange={(e) => setInStockWords(e.target.value)} placeholder="In Stock" style={{ width: "100%" }} />
        <FieldHint>
          Only for files with no numeric quantity. Comma-separated words in the quantity column that mean in stock; each is treated
          as the in-stock threshold. Leave both boxes empty for a normal numeric quantity.
        </FieldHint>
      </label>
      <label>
        Out-of-stock words (optional)
        <br />
        <input value={outOfStockWords} onChange={(e) => setOutOfStockWords(e.target.value)} placeholder="Out of Stock" style={{ width: "100%" }} />
        <FieldHint>Words that mean out of stock (treated as 0). Any other word, or a blank, is blocked on the review screen instead of guessed.</FieldHint>
      </label>
    </>
  );
}

/** Edit form for any vendor, any file_shape (shown inside VendorEditModal). columnMapping fields only show for simple_csv vendors. */
function EditVendorForm({ vendor, onDone, onCancel }: { vendor: VendorConfig; onDone: () => void; onCancel: () => void }) {
  const [vendorLabel, setVendorLabel] = useState(vendor.vendorLabel);
  const [inStockThreshold, setInStockThreshold] = useState(String(vendor.inStockThreshold));
  const [discontinuedThreshold, setDiscontinuedThreshold] = useState(vendor.discontinuedThreshold === null ? "" : String(vendor.discontinuedThreshold));
  const [updateAllOnSharedKey, setUpdateAllOnSharedKey] = useState(vendor.updateAllOnSharedKey);
  const [timezone, setTimezone] = useState(vendor.timezone);
  const [brandAllowlist, setBrandAllowlist] = useState(vendor.brandAllowlist.join(", "));
  const [matchStrategy, setMatchStrategy] = useState(vendor.matchStrategy);
  const hasParserChoice = vendor.parserVersions.length > 0;
  const [activeParserVersion, setActiveParserVersion] = useState(vendor.activeParserVersion ?? vendor.parserVersions[0]?.version ?? "");
  const [identifierColumn, setIdentifierColumn] = useState(vendor.columnMapping?.identifierColumn ?? "");
  const [identifierType, setIdentifierType] = useState<"upc" | "sku">(vendor.columnMapping?.identifierType ?? "upc");
  const [secondaryIdentifierColumn, setSecondaryIdentifierColumn] = useState(vendor.columnMapping?.secondaryIdentifierColumn ?? "");
  const [descriptionColumn, setDescriptionColumn] = useState(vendor.columnMapping?.descriptionColumn ?? "");
  const [quantityColumn, setQuantityColumn] = useState(vendor.columnMapping?.quantityColumn ?? "");
  const [inStockWords, setInStockWords] = useState((vendor.columnMapping?.stockTextValues?.inStock ?? []).join(", "));
  const [outOfStockWords, setOutOfStockWords] = useState((vendor.columnMapping?.stockTextValues?.outOfStock ?? []).join(", "));
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
        discontinuedThreshold: discontinuedThreshold.trim() === "" ? null : Number(discontinuedThreshold),
        updateAllOnSharedKey,
        timezone,
        brandAllowlist: parseAllowlist(brandAllowlist),
        matchStrategy,
        ...(hasParserChoice ? { activeParserVersion } : {}),
        ...(vendor.fileShape === "simple_csv"
          ? {
              columnMapping: {
                identifierColumn,
                identifierType,
                secondaryIdentifierColumn: matchStrategy === "upc-or-sku" ? secondaryIdentifierColumn : undefined,
                descriptionColumn: descriptionColumn || undefined,
                quantityColumn,
                stockTextValues: buildStockText(inStockWords, outOfStockWords),
              },
            }
          : {}),
      });
      onDone();
    } catch (err) {
      console.error(err);
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to update vendor.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 4 }}>
      {error && <ErrorBanner message={error} />}
      <div className="grid cols-2" style={{ minWidth: 0, alignItems: "start" }}>
        <label>
          Vendor label
          <br />
          <input type="text" value={vendorLabel} onChange={(e) => setVendorLabel(e.target.value)} style={{ width: "100%" }} required />
        </label>
        <label>
          Timezone (IANA)
          <br />
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="America/New_York"
            style={{ width: "100%" }}
            required
          />
          <FieldHint>{TIMEZONE_HINT}</FieldHint>
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
          <FieldHint>{IN_STOCK_THRESHOLD_HINT}</FieldHint>
        </label>
        <label>
          Discontinued threshold
          <br />
          <input
            type="number"
            min={1}
            step={1}
            value={discontinuedThreshold}
            onChange={(e) => setDiscontinuedThreshold(e.target.value)}
            placeholder="Off"
            style={{ width: "100%" }}
          />
          <FieldHint>{DISCONTINUED_THRESHOLD_HINT}</FieldHint>
        </label>
        <label>
          Match strategy
          <br />
          <select
            value={matchStrategy}
            onChange={(e) => setMatchStrategy(e.target.value as VendorConfig["matchStrategy"])}
            style={{ width: "100%" }}
          >
            <option value="upc-to-gtin">UPC to GTIN</option>
            <option value="sku-to-mpn">SKU to MPN</option>
            <option value="upc-or-sku">Both (UPC + SKU)</option>
          </select>
          <FieldHint>{MATCH_STRATEGY_HINT}</FieldHint>
        </label>
        <label>
          Shared SKU / UPC across products
          <br />
          <select
            value={updateAllOnSharedKey ? "all" : "block"}
            onChange={(e) => setUpdateAllOnSharedKey(e.target.value === "all")}
            style={{ width: "100%" }}
          >
            <option value="block">Block (update none)</option>
            <option value="all">Update all products</option>
          </select>
          <FieldHint>{SHARED_KEY_HINT}</FieldHint>
        </label>
        <label>
          Active file parser
          <br />
          {hasParserChoice ? (
            <>
              <select value={activeParserVersion} onChange={(e) => setActiveParserVersion(e.target.value)} style={{ width: "100%" }}>
                {vendor.parserVersions.map((p) => (
                  <option key={p.version} value={p.version}>
                    {p.label}
                  </option>
                ))}
              </select>
              <FieldHint>
                {vendor.parserVersions.find((p) => p.version === activeParserVersion)?.notes} {PARSER_VERSION_HINT}
              </FieldHint>
            </>
          ) : (
            <>
              <select value="v1" disabled style={{ width: "100%" }}>
                <option value="v1">v1</option>
              </select>
              <FieldHint>This vendor has one file parser (v1), so there is nothing to switch. A second version appears here when one is added.</FieldHint>
            </>
          )}
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Brand allowlist (comma-separated, e.g. "Beautyrest, Serta, Woolrich" for Olliix)
          <br />
          <input
            type="text"
            value={brandAllowlist}
            onChange={(e) => setBrandAllowlist(e.target.value)}
            style={{ width: "100%" }}
            required
          />
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
          {matchStrategy === "upc-or-sku" && (
            <label>
              Second identifier column name ({identifierType === "upc" ? "SKU" : "UPC"})
              <br />
              <input
                value={secondaryIdentifierColumn}
                onChange={(e) => setSecondaryIdentifierColumn(e.target.value)}
                style={{ width: "100%" }}
                required
              />
              <FieldHint>The column holding the other identifier -- checked independently alongside the one above.</FieldHint>
            </label>
          )}
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
          <StockWordsFields
            inStockWords={inStockWords}
            outOfStockWords={outOfStockWords}
            setInStockWords={setInStockWords}
            setOutOfStockWords={setOutOfStockWords}
          />
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

function AddVendorForm({
  pluginFiles,
  onDone,
  onCancel,
  onReloadPlugins,
}: {
  pluginFiles: string[];
  onDone: () => void;
  onCancel: () => void;
  onReloadPlugins: () => void;
}) {
  const [mode, setMode] = useState<"simple_csv" | "plugin">("simple_csv");
  const [vendorKey, setVendorKey] = useState("");
  const [vendorLabel, setVendorLabel] = useState("");
  const [inStockThreshold, setInStockThreshold] = useState("6");
  const [timezone, setTimezone] = useState("America/New_York");
  const [brandAllowlist, setBrandAllowlist] = useState("");
  const [matchStrategy, setMatchStrategy] = useState<"upc-to-gtin" | "sku-to-mpn" | "upc-or-sku">("upc-to-gtin");
  const [identifierColumn, setIdentifierColumn] = useState("");
  const [identifierType, setIdentifierType] = useState<"upc" | "sku">("upc");
  const [secondaryIdentifierColumn, setSecondaryIdentifierColumn] = useState("");
  const [descriptionColumn, setDescriptionColumn] = useState("");
  const [quantityColumn, setQuantityColumn] = useState("");
  const [inStockWords, setInStockWords] = useState("");
  const [outOfStockWords, setOutOfStockWords] = useState("");
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
              columnMapping: {
                identifierColumn,
                identifierType,
                secondaryIdentifierColumn: matchStrategy === "upc-or-sku" ? secondaryIdentifierColumn : undefined,
                descriptionColumn: descriptionColumn || undefined,
                quantityColumn,
                stockTextValues: buildStockText(inStockWords, outOfStockWords),
              },
            }
          : { ...common, fileShape: "plugin", pluginFilename };
      await api.createVendor(input);
      setVendorKey("");
      setVendorLabel("");
      setInStockThreshold("6");
      setBrandAllowlist("");
      setIdentifierColumn("");
      setSecondaryIdentifierColumn("");
      setDescriptionColumn("");
      setQuantityColumn("");
      setPluginFilename("");
      onDone();
    } catch (err) {
      console.error(err);
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to create vendor.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <ErrorBanner message={error} />}

      <div className="grid cols-2">
        <label>
          Vendor key
          <br />
          <input
            value={vendorKey}
            onChange={(e) => setVendorKey(e.target.value)}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="lowercase letters, numbers, and hyphens only"
            placeholder="acme-co"
            style={{ width: "100%" }}
            required
          />
          <FieldHint>
            <strong style={{ color: "var(--red)" }}>Cannot be changed after creation.</strong> Lowercase letters, numbers, and hyphens only.
          </FieldHint>
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
          <FieldHint>{IN_STOCK_THRESHOLD_HINT}</FieldHint>
        </label>
        <label>
          Timezone (IANA)
          <br />
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/New_York" style={{ width: "100%" }} required />
          <FieldHint>{TIMEZONE_HINT}</FieldHint>
        </label>
        <label>
          Match strategy
          <br />
          <select
            value={matchStrategy}
            onChange={(e) => setMatchStrategy(e.target.value as "upc-to-gtin" | "sku-to-mpn" | "upc-or-sku")}
            style={{ width: "100%" }}
          >
            <option value="upc-to-gtin">UPC to GTIN</option>
            <option value="sku-to-mpn">SKU to MPN</option>
            <option value="upc-or-sku">Both (UPC + SKU)</option>
          </select>
          <FieldHint>{MATCH_STRATEGY_HINT}</FieldHint>
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Brand allowlist (comma-separated, e.g. "Beautyrest, Serta, Woolrich" for Olliix)
          <br />
          <input
            value={brandAllowlist}
            onChange={(e) => setBrandAllowlist(e.target.value)}
            style={{ width: "100%" }}
            required
          />
        </label>
      </div>

      <p style={{ fontWeight: 600, marginTop: 20, marginBottom: 8 }}>How does this vendor's file work?</p>

      <div className={`radio-card${mode === "simple_csv" ? " selected" : ""}`}>
        <label className="radio-card-head">
          <input type="radio" name="fileShapeMode" checked={mode === "simple_csv"} onChange={() => setMode("simple_csv")} />
          CSV / XLSX with named columns
        </label>
        <p className="radio-card-hint">
          A plain table with one header row -- e.g. UPC, Description, Qty. Either .csv or .xlsx (first sheet) is
          accepted; no code needed.
        </p>
        {mode === "simple_csv" && (
          <div className="radio-card-body grid cols-2">
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
            {matchStrategy === "upc-or-sku" && (
              <label>
                Second identifier column name ({identifierType === "upc" ? "SKU" : "UPC"})
                <br />
                <input
                  value={secondaryIdentifierColumn}
                  onChange={(e) => setSecondaryIdentifierColumn(e.target.value)}
                  style={{ width: "100%" }}
                  required
                />
                <FieldHint>The column holding the other identifier -- checked independently alongside the one above.</FieldHint>
              </label>
            )}
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
            <StockWordsFields
              inStockWords={inStockWords}
              outOfStockWords={outOfStockWords}
              setInStockWords={setInStockWords}
              setOutOfStockWords={setOutOfStockWords}
            />
          </div>
        )}
      </div>

      <div className={`radio-card${mode === "plugin" ? " selected" : ""}`}>
        <label className="radio-card-head">
          <input type="radio" name="fileShapeMode" checked={mode === "plugin"} onChange={() => setMode("plugin")} />
          Custom parser file
        </label>
        <p className="radio-card-hint">
          For irregular files (multi-row headers, brand filtering) that named columns can't describe. Requires a
          developer to write a small parser file -- this form never uploads or runs arbitrary code, it only points
          at a file already placed on the server.
        </p>
        {mode === "plugin" && (
          <div className="radio-card-body">
            <div
              style={{
                fontSize: 13,
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                marginBottom: 12,
              }}
            >
              <strong>To add a new parser file:</strong> a developer places a <code>.js</code> file in{" "}
              <code>data/vendor-plugins/</code> on the server (or the folder set by the{" "}
              <code>VENDOR_PLUGINS_DIR</code> env var). The file must export a <code>parse(buffer)</code> function
              returning <code>{"{ rows: VendorRawRow[] }"}</code> -- see any existing file in{" "}
              <code>packages/server/src/vendor/</code> for the shape. Once it's on disk, click "Reload plugin files"
              below and it will appear in the dropdown.
            </div>
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
              <RefreshCw size={14} /> Reload plugin files
            </button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <button className="primary" type="submit" disabled={creating}>
          {creating ? "Adding..." : "Add vendor"}
        </button>
        <button type="button" onClick={onCancel} style={{ marginLeft: 8 }} disabled={creating}>
          Cancel
        </button>
      </div>
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
  const editingVendor = vendors.find((v) => v.vendorKey === editingKey) ?? null;
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showAddVendor, setShowAddVendor] = useState(false);

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
      console.error(err);
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to reload plugins.");
    }
  }

  // Deactivation is soft and one-way from this UI (DELETE /vendors/:key sets
  // is_active = false) -- there is no reactivate route, matching the backend
  // spec (a deactivated vendor is expected to be re-created or restored by a
  // developer, not casually flipped back on).
  async function deactivate(v: VendorConfig) {
    if (
      !window.confirm(
        `Deactivate vendor "${v.vendorLabel}"? It will no longer be available when starting a new run. Existing runs and batches for this vendor are unaffected. This cannot be undone from this screen.`,
      )
    )
      return;
    setBusyKey(v.vendorKey);
    setError(null);
    try {
      await api.deleteVendor(v.vendorKey);
      refresh();
    } catch (err) {
      console.error(err);
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Truck size={24} strokeWidth={2.25} /> Manage Vendors
        </h2>
        {!showAddVendor && (
          <button className="primary" onClick={() => setShowAddVendor(true)}>
            <Plus size={16} /> Add vendor
          </button>
        )}
      </div>
      <InstructionsCard
        pageKey="manage-vendors"
        description="Configure vendor file shapes, column mappings, and matching rules."
        steps={[
          "Click + Add vendor to configure a new vendor file source.",
          "Edit or deactivate an existing vendor from the table below.",
        ]}
      />
      <div className="card">
        <Link to="/settings">Back to settings</Link>
      </div>
      {error && <ErrorBanner message={error} />}

      <div className="card">
        <h3>Vendors</h3>
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Match strategy</th>
              <th title="Minimum vendor quantity treated as in stock.">In-stock threshold</th>
              <th title="A discontinued product with fewer units than this is proposed as No Longer Available. Off = not used for this vendor.">Discontinued threshold</th>
              <th>Brands</th>
              <th>File shape</th>
              <th title="Which file parser version is tried first. Vendors with a single parser show v1.">Active parser</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9}>Loading...</td>
              </tr>
            )}
            {!loading && vendors.length === 0 && (
              <tr>
                <td colSpan={9}>No vendors yet.</td>
              </tr>
            )}
            {vendors.map((v) => (
              <Fragment key={v.vendorKey}>
                <tr>
                  <td>{v.vendorLabel}</td>
                  <td title={MATCH_STRATEGY_HINT}>{MATCH_STRATEGY_LABELS[v.matchStrategy] ?? v.matchStrategy}</td>
                  <td>{v.inStockThreshold}</td>
                  <td>{v.discontinuedThreshold === null ? "Off" : v.discontinuedThreshold}</td>
                  <td title={v.brandAllowlist.join(", ") || undefined}>
                    {v.brandAllowlist.length <= 2
                      ? v.brandAllowlist.join(", ") || "-"
                      : `${v.brandAllowlist.slice(0, 2).join(", ")} +${v.brandAllowlist.length - 2} more`}
                  </td>
                  <td>{FILE_SHAPE_LABELS[v.fileShape] ?? v.fileShape}</td>
                  <td title={v.parserVersions.find((p) => p.version === (v.activeParserVersion ?? v.parserVersions[0]?.version))?.label}>
                    {v.parserVersions.length > 0 ? (v.activeParserVersion ?? v.parserVersions[0]!.version) : "v1"}
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
                        background: v.isActive ? "var(--green-soft)" : "var(--panel-2)",
                        color: v.isActive ? "var(--green)" : "var(--muted)",
                      }}
                    >
                      {v.isActive ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      {v.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => setEditingKey(v.vendorKey)}>
                      <Pencil size={14} /> Edit
                    </button>
                    {v.isActive && (
                      <button className="danger" disabled={busyKey === v.vendorKey} onClick={() => deactivate(v)} style={{ marginLeft: 8 }}>
                        <Ban size={14} /> Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {editingVendor && (
        <VendorEditModal vendor={editingVendor} onClose={() => setEditingKey(null)}>
          <EditVendorForm
            vendor={editingVendor}
            onDone={() => {
              setEditingKey(null);
              refresh();
            }}
            onCancel={() => setEditingKey(null)}
          />
        </VendorEditModal>
      )}

      {showAddVendor && (
        <div className="card">
          <h3>Add vendor</h3>
          <AddVendorForm
            pluginFiles={pluginFiles}
            onDone={() => {
              setShowAddVendor(false);
              refresh();
            }}
            onCancel={() => setShowAddVendor(false)}
            onReloadPlugins={reloadPlugins}
          />
        </div>
      )}
    </div>
  );
}
