import { useEffect, useRef, useState } from "react";
import { Bookmark, MoreHorizontal } from "lucide-react";
import type { CatalogViewsPayload, CatalogViewDto } from "../api";

interface Props {
  payload: CatalogViewsPayload | null;
  /** Id of the view the page is currently showing, or null for an unsaved setup. */
  activeViewId: string | null;
  /** True when columns/filters/sort no longer match the active view. */
  modified: boolean;
  isAdmin: boolean;
  busy: boolean;
  error: string | null;
  onSelect: (viewId: string | null) => void;
  onSaveNew: (name: string, isShared: boolean) => Promise<void>;
  onUpdate: () => Promise<void>;
  onRevert: () => void;
  onRename: (name: string) => Promise<void>;
  onSetShared: (isShared: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
  onSetDefault: (scope: "personal" | "team", viewId: string | null) => Promise<void>;
}

type FormMode = "save" | "rename" | null;

/**
 * The Catalog's saved-views control: pick a view, save the current setup as a
 * new one, update or revert the selected one, and manage sharing/defaults. It
 * holds only its own transient UI state (the name form, the menu); everything
 * that touches the table or the server is passed in, so the page stays the
 * single owner of columns, filters and sort.
 */
export function CatalogViewsBar(props: Props) {
  const { payload, activeViewId, modified, isAdmin, busy, error } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [formName, setFormName] = useState("");
  const [formShared, setFormShared] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const views = payload?.views ?? [];
  const builtins = payload?.builtins ?? [];
  const active: CatalogViewDto | null = views.find((v) => v.id === activeViewId) ?? null;
  const activeIsBuiltin = activeViewId !== null && builtins.some((b) => b.id === activeViewId);
  const myDefault = payload?.defaults.personal ?? null;
  const teamDefault = payload?.defaults.team ?? null;

  const mine = views.filter((v) => v.isMine);
  const others = views.filter((v) => !v.isMine);

  function label(id: string, name: string, suffix = ""): string {
    const stars = [id === myDefault ? "my default" : "", id === teamDefault ? "team default" : ""].filter(Boolean).join(", ");
    return `${name}${suffix}${stars ? ` (${stars})` : ""}`;
  }

  function openForm(mode: Exclude<FormMode, null>) {
    setMenuOpen(false);
    setFormMode(mode);
    setFormName(mode === "rename" ? (active?.name ?? "") : "");
    setFormShared(false);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    const name = formName.trim();
    if (!name) return;
    try {
      if (formMode === "save") await props.onSaveNew(name, formShared);
      else if (formMode === "rename") await props.onRename(name);
      setFormMode(null);
    } catch {
      // The page shows the server's message in `error`; keep the form open so the name can be fixed.
    }
  }

  async function run(action: () => Promise<void>) {
    setMenuOpen(false);
    try {
      await action();
    } catch {
      // Surfaced through `error`.
    }
  }

  const canChangeActive = active !== null && active.canEdit;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          <Bookmark size={14} /> View
          <select
            value={activeViewId ?? ""}
            disabled={busy || payload === null}
            onChange={(e) => props.onSelect(e.target.value === "" ? null : e.target.value)}
            style={{ minWidth: 220 }}
            title="Saved column, filter and sort setups. Picking one replaces your current columns, filters and sort."
          >
            <option value="">Current setup (not saved as a view)</option>
            {builtins.length > 0 && (
              <optgroup label="Built-in">
                {builtins.map((b) => (
                  <option key={b.id} value={b.id}>
                    {label(b.id, b.name, b.id === activeViewId && modified ? " (modified)" : "")}
                  </option>
                ))}
              </optgroup>
            )}
            {mine.length > 0 && (
              <optgroup label="My views">
                {mine.map((v) => (
                  <option key={v.id} value={v.id}>
                    {label(v.id, v.name, `${v.isShared ? " (shared)" : ""}${v.id === activeViewId && modified ? " (modified)" : ""}`)}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Shared with the team">
                {others.map((v) => (
                  <option key={v.id} value={v.id}>
                    {label(v.id, `${v.name} - ${v.ownerLabel}`, v.id === activeViewId && modified ? " (modified)" : "")}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        {modified && (
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            Changed since this view was saved.
          </span>
        )}

        <button disabled={busy} onClick={() => openForm("save")} title="Save your current columns, order, widths, filters and sort as a new view.">
          Save as new view
        </button>
        {canChangeActive && modified && (
          <button disabled={busy} className="primary" onClick={() => run(props.onUpdate)} title="Overwrite the selected view with your current setup.">
            Update view
          </button>
        )}
        {active !== null && !active.canEdit && modified && (
          <span style={{ color: "var(--muted)", fontSize: 12 }}>Only {active.ownerLabel} or an admin can update this view. Use Save as new view to keep your version.</span>
        )}
        {activeViewId !== null && modified && (
          <button disabled={busy} onClick={props.onRevert} title="Discard your changes and reapply the saved view.">
            Revert
          </button>
        )}

        {activeViewId !== null && (
          <div ref={menuRef} style={{ position: "relative" }}>
            <button disabled={busy} onClick={() => setMenuOpen((v) => !v)} aria-label="More view actions" title="Rename, share, set default, delete">
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  background: "white",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                  padding: 6,
                  width: 230,
                  zIndex: 30,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {canChangeActive && <MenuButton onClick={() => openForm("rename")}>Rename</MenuButton>}
                {canChangeActive && (
                  <MenuButton onClick={() => run(() => props.onSetShared(!active!.isShared))}>
                    {active!.isShared ? "Make private (stop sharing)" : "Share with the team"}
                  </MenuButton>
                )}
                {activeViewId === myDefault ? (
                  <MenuButton onClick={() => run(() => props.onSetDefault("personal", null))}>Clear my default</MenuButton>
                ) : (
                  <MenuButton onClick={() => run(() => props.onSetDefault("personal", activeViewId))}>Make this my default</MenuButton>
                )}
                {isAdmin &&
                  (activeViewId === teamDefault ? (
                    <MenuButton onClick={() => run(() => props.onSetDefault("team", null))}>Clear team default</MenuButton>
                  ) : (
                    <MenuButton
                      disabled={active !== null && !active.isShared}
                      onClick={() => run(() => props.onSetDefault("team", activeViewId))}
                      title={active !== null && !active.isShared ? "Share the view with the team first." : undefined}
                    >
                      Make this the team default
                    </MenuButton>
                  ))}
                {canChangeActive && !activeIsBuiltin && (
                  <MenuButton danger onClick={() => run(props.onDelete)}>
                    Delete view
                  </MenuButton>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {formMode !== null && (
        <form onSubmit={submitForm} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <input
            autoFocus
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            maxLength={60}
            placeholder={formMode === "save" ? "Name this view" : "New name"}
            style={{ width: 240 }}
          />
          {formMode === "save" && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={formShared} onChange={(e) => setFormShared(e.target.checked)} />
              Share with the team
            </label>
          )}
          <button type="submit" className="primary" disabled={busy || formName.trim() === ""}>
            {formMode === "save" ? "Save view" : "Rename"}
          </button>
          <button type="button" onClick={() => setFormMode(null)}>
            Cancel
          </button>
        </form>
      )}

      {error && (
        <div style={{ color: "var(--danger, #b91c1c)", fontSize: 13, marginTop: 6 }} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function MenuButton(props: { children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      style={{ width: "100%", textAlign: "left", fontSize: 13, ...(props.danger ? { color: "#b91c1c" } : {}) }}
    >
      {props.children}
    </button>
  );
}
