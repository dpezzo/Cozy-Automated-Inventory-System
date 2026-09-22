// Per-viewer browser storage (column visibility, widths, etc.) -- never
// reaches the server or other viewers. Wrapped in try/catch since access can
// throw (private window, blocked site data) and is fine to silently skip.
export function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // per-viewer convenience only -- fine to silently skip if storage is unavailable
  }
}
