/**
 * Interprets a vendor-reported lifecycle/phase string (Gobi's "Product Phase"
 * column: Active / End of Life (EOL) / Discontinued). Deliberately a
 * tolerant, normalized contains-match rather than an exact-string compare, so
 * "End of Life (EOL)", "end of life", "EOL" and "Discontinued" all resolve --
 * but a value that matches nothing is reported as "unrecognized" rather than
 * silently treated as a known phase.
 */
export type ProductPhase = "ACTIVE" | "END_OF_LIFE_OR_DISCONTINUED" | "UNRECOGNIZED";

export function interpretProductPhase(raw: string | null | undefined): ProductPhase {
  const text = (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  // A blank/absent phase means the vendor file carries no lifecycle info for
  // this row (old Gobi format, or a vendor without the column) -- that is
  // plain "Active", not an anomaly worth a warning.
  if (text === "") return "ACTIVE";
  if (text.includes("discontinu") || text.includes("end of life") || /\beol\b/.test(text)) {
    return "END_OF_LIFE_OR_DISCONTINUED";
  }
  if (text === "active") return "ACTIVE";
  return "UNRECOGNIZED";
}
