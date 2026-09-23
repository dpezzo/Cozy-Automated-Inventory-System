import { X } from "lucide-react";

const TERMS: { term: string; definition: string }[] = [
  {
    term: "Reconciliation",
    definition: "Comparing a vendor's reported stock counts against what's currently live on the Miva store, so the two can be brought into agreement.",
  },
  { term: "Run", definition: "One reconciliation: one vendor inventory file compared against one Miva catalog snapshot." },
  {
    term: "Batch",
    definition: "The set of approved, changed rows from a run, packaged into ready-to-import Miva files. A run can produce more than one batch over time.",
  },
  { term: "Vendor file", definition: "The inventory report a vendor/supplier sends, listing what they have in stock." },
  { term: "Miva", definition: "The e-commerce platform that runs the storefront -- the live website customers see." },
  {
    term: "Review class",
    definition:
      "CLEAN: no issues, can be approved directly. WARNING: unusual data -- review before approving. BLOCKED: has a data problem and can't be approved. UNCHANGED: nothing to update.",
  },
  { term: "NLA", definition: "\"No longer available\" -- a product Miva has that the vendor file doesn't mention, so it may no longer be sold." },
  { term: "Frozen / locked", definition: "A decision can't be changed anymore because it's already part of a generated batch." },
  { term: "Legacy comparison", definition: "A one-time check comparing this app's results against the old spreadsheet-based process, to confirm they agree." },
  { term: "Verification", definition: "Uploading a fresh Miva export after an import to confirm the approved changes actually landed." },
];

export function Glossary({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Glossary"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 480, maxHeight: "80vh", overflow: "auto", margin: 0 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Glossary</h3>
          <button onClick={onClose} aria-label="Close glossary" style={{ padding: "4px 8px" }}>
            <X size={16} />
          </button>
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>Terms used throughout this app, in plain language.</p>
        <dl style={{ margin: 0 }}>
          {TERMS.map(({ term, definition }) => (
            <div key={term} style={{ marginBottom: 14 }}>
              <dt style={{ fontWeight: 700 }}>{term}</dt>
              <dd style={{ margin: "2px 0 0", fontSize: 13, color: "var(--muted)" }}>{definition}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
