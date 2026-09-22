export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const IMPORT_STATUS_PILL_CLASS: Record<string, string> = {
  VERIFIED: "clean",
  API_PUSH_SUCCEEDED: "clean",
  VERIFICATION_FAILED: "blocked",
  IMPORT_FAILED: "blocked",
  API_PUSH_FAILED: "blocked",
  API_PUSH_PARTIAL_FAILURE: "blocked",
};

/** Maps a batch's importStatus to a .pill modifier class (see styles.css) -- shared by RunHistoryPage and RunReviewPage so a batch's status reads the same wherever it's linked from. */
export function importStatusPillClass(status: string): string {
  return IMPORT_STATUS_PILL_CLASS[status] ?? "pending";
}

const RUN_STATUS_PILL_CLASS: Record<string, string> = {
  ready: "clean",
  failed: "blocked",
};

/** Maps a run's status (RunStatus: validating/normalizing/matching/calculating/ready/failed) to a .pill modifier class, matching importStatusPillClass's clean/blocked/pending convention so the Runs and Batches tables read the same way at a glance. */
export function runStatusPillClass(status: string): string {
  return RUN_STATUS_PILL_CLASS[status] ?? "pending";
}
