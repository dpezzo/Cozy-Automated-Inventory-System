import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Inbox } from "lucide-react";
import { api, type AutopilotSettings, type AutopilotBrakeLimits } from "../api";
import { useAuth } from "../AuthContext";
import { InstructionsCard } from "../components/InstructionsCard";
import { ErrorBanner } from "../components/ErrorBanner";
import { friendlyError } from "../lib/errors";
import { formatEastern } from "../lib/format";

const OUTCOME_LABEL: Record<string, string> = {
  REVIEWED: "Reviewed",
  HELD: "Would have been held",
  DUPLICATE: "Already processed",
  REJECTED: "Rejected",
  IGNORED: "Ignored",
  FAILED: "Failed",
};

export default function AutopilotPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [settings, setSettings] = useState<AutopilotSettings | null>(null);
  const [senderDrafts, setSenderDrafts] = useState<Record<string, string>>({});
  const [holdDraft, setHoldDraft] = useState("");
  const [brakeDraft, setBrakeDraft] = useState<Record<keyof AutopilotBrakeLimits, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function adopt(next: AutopilotSettings) {
    setSettings(next);
    setSenderDrafts(Object.fromEntries(next.vendors.map((v) => [v.vendorKey, v.approvedSenders.join(", ")])));
    setHoldDraft(String(next.holdMinutes));
    setBrakeDraft({
      minRowRatio: String(Math.round(next.brakeLimits.minRowRatio * 100)),
      maxChangedPercent: String(next.brakeLimits.maxChangedPercent),
      maxNlaProposals: String(next.brakeLimits.maxNlaProposals),
      maxMissingOrBlockedPercent: String(next.brakeLimits.maxMissingOrBlockedPercent),
    });
  }

  useEffect(() => {
    api
      .getAutopilot()
      .then(adopt)
      .catch((err) => setError(friendlyError(err, "Failed to load the autopilot settings.")));
  }, []);

  async function save(patch: Parameters<typeof api.setAutopilot>[0], message: string) {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      adopt(await api.setAutopilot(patch));
      setSaved(message);
    } catch (err) {
      console.error(err);
      setError(friendlyError(err, "Failed to save the autopilot settings."));
    } finally {
      setSaving(false);
    }
  }

  function saveBrake() {
    if (!brakeDraft) return;
    void save(
      {
        brakeLimits: {
          minRowRatio: Number(brakeDraft.minRowRatio) / 100,
          maxChangedPercent: Number(brakeDraft.maxChangedPercent),
          maxNlaProposals: Number(brakeDraft.maxNlaProposals),
          maxMissingOrBlockedPercent: Number(brakeDraft.maxMissingOrBlockedPercent),
        },
      },
      "Safety brake limits saved.",
    );
  }

  const disabled = !isAdmin || settings === null || saving;

  return (
    <div>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Inbox size={24} strokeWidth={2.25} /> Autopilot
      </h2>
      <InstructionsCard
        pageKey="autopilot"
        description="Approved people can email a vendor file to the inventory mailbox. In review-only mode the hub reads it, compares it to Miva, and emails the admins what it would have done. It never sends anything to Miva."
      />
      <div className="card">
        <Link to="/settings">Back to settings</Link>
      </div>
      {error && <ErrorBanner message={error} />}
      {!isAdmin && <p style={{ fontSize: 13, color: "var(--muted)" }}>Only an admin can change these settings.</p>}
      {settings && !settings.featureEnabled && (
        <div className="card">
          Autopilot is turned off for everyone. Turn on <strong>Email autopilot</strong> in <Link to="/settings/features">Settings &gt; Features</Link> first.
        </div>
      )}

      {settings && (
        <>
          <div className="card">
            <h3>Mode</h3>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                name="autopilot-mode"
                checked={settings.mode === "off"}
                disabled={disabled}
                onChange={() => void save({ mode: "off" }, "Autopilot is off.")}
              />
              Off
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                name="autopilot-mode"
                checked={settings.mode === "review"}
                disabled={disabled}
                onChange={() => void save({ mode: "review" }, "Autopilot is reviewing and reporting only.")}
              />
              Review only (reads the mailbox and reports; sends nothing to Miva)
            </label>
            <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
              Mailbox: {settings.poller.mailboxConfigured ? "connected settings found" : "not set up on this server (AUTOPILOT_IMAP_USER / AUTOPILOT_IMAP_PASSWORD missing)"}.{" "}
              {settings.poller.lastPollAt ? `Last check: ${formatEastern(settings.poller.lastPollAt)}${settings.poller.lastError ? `, with an error: ${settings.poller.lastError}` : ""}.` : "Not checked yet since the server started."}
            </p>
            {saved && <p style={{ fontSize: 13, color: "var(--green)" }}>{saved}</p>}
          </div>

          <div className="card">
            <h3>Vendors</h3>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              Turn autopilot on per vendor, and list the addresses allowed to send that vendor's files, separated by commas.
            </p>
            {settings.vendors.map((v) => (
              <div key={v.vendorKey} style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={v.enabled}
                    disabled={disabled}
                    onChange={(e) =>
                      void save({ vendors: { [v.vendorKey]: { enabled: e.target.checked } } }, `${v.vendorLabel} autopilot ${e.target.checked ? "on" : "off"}.`)
                    }
                  />
                  <strong>{v.vendorLabel}</strong>
                </label>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <input
                    type="text"
                    aria-label={`Approved senders for ${v.vendorLabel}`}
                    value={senderDrafts[v.vendorKey] ?? ""}
                    disabled={disabled}
                    onChange={(e) => setSenderDrafts({ ...senderDrafts, [v.vendorKey]: e.target.value })}
                    style={{ flex: 1 }}
                  />
                  <button
                    disabled={disabled || senderDrafts[v.vendorKey] === v.approvedSenders.join(", ")}
                    onClick={() => void save({ vendors: { [v.vendorKey]: { approvedSenders: senderDrafts[v.vendorKey] ?? "" } } }, `${v.vendorLabel} approved senders saved.`)}
                  >
                    Save senders
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Hold time</h3>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              How many minutes a held run waits before a later stage may act on it. Review-only mode never pushes, so this does not change anything yet.
            </p>
            <input type="number" min={1} max={1440} value={holdDraft} disabled={disabled} onChange={(e) => setHoldDraft(e.target.value)} style={{ width: 90 }} /> minutes{" "}
            <button disabled={disabled || holdDraft === String(settings.holdMinutes)} onClick={() => void save({ holdMinutes: Number(holdDraft) }, "Hold time saved.")}>
              Save
            </button>
          </div>

          <div className="card">
            <h3>Safety brake</h3>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              A run is flagged "would have been held" when it crosses any limit. Percentages are of the products we carry, not the vendor's whole file.
            </p>
            {brakeDraft && (
              <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
                {(
                  [
                    ["minRowRatio", "File must have at least this % of the previous file's rows"],
                    ["maxChangedPercent", "Hold if more than this % of carried products would change"],
                    ["maxNlaProposals", "Hold if more than this many products would go No Longer Available"],
                    ["maxMissingOrBlockedPercent", "Hold if more than this % of carried products are missing or blocked"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min={0}
                      value={brakeDraft[key]}
                      disabled={disabled}
                      onChange={(e) => setBrakeDraft({ ...brakeDraft, [key]: e.target.value })}
                      style={{ width: 90 }}
                    />
                  </label>
                ))}
                <div>
                  <button disabled={disabled} onClick={saveBrake}>
                    Save limits
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h3>Recent emails</h3>
            {settings.recent.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--muted)" }}>Nothing handled yet.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>From</th>
                      <th>Subject</th>
                      <th>Result</th>
                      <th>Why / run</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settings.recent.map((m) => (
                      <tr key={m.id}>
                        <td>{formatEastern(m.createdAt)}</td>
                        <td>{m.sender ?? ""}</td>
                        <td>{m.subject ?? ""}</td>
                        <td>{OUTCOME_LABEL[m.outcome] ?? m.outcome}</td>
                        <td>
                          {m.runId ? <Link to={`/runs/${m.runId}`}>Open run</Link> : typeof m.details.reason === "string" ? m.details.reason : typeof m.details.error === "string" ? m.details.error : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
