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

/** Plain-language explanation for each importStatus value, shown as a title= tooltip anywhere a batch's import status is displayed (RunHistoryPage, RunReviewPage, BatchDetailPage) -- the raw SCREAMING_SNAKE_CASE values are otherwise meaningless to a new employee. */
export const IMPORT_STATUS_TOOLTIPS: Record<string, string> = {
  GENERATED: "The batch's files exist but nothing has been downloaded, imported, or pushed yet.",
  DOWNLOADED: "The CSV files were downloaded, but the manual import into Miva hasn't been recorded yet.",
  IMPORT_REPORTED: "The CSV files were manually imported into Miva and confirmed to have succeeded.",
  IMPORT_FAILED: "The manual CSV import into Miva failed or was abandoned.",
  VERIFIED: "Post-import verification confirmed the changes landed correctly in Miva.",
  VERIFICATION_FAILED: "Post-import verification found mismatches between what should have imported and what's actually in Miva -- open the batch to review.",
  API_PUSH_SUCCEEDED: "This batch was pushed to Miva via the API, and it verified successfully.",
  API_PUSH_FAILED: "The API push to Miva failed -- no changes were applied. Open the batch to investigate or retry.",
  API_PUSH_PARTIAL_FAILURE: "The API push to Miva partly succeeded -- some rows applied, others failed. Open the batch to see which.",
};

const RUN_STATUS_PILL_CLASS: Record<string, string> = {
  ready: "clean",
  failed: "blocked",
};

/** Maps a run's status (RunStatus: validating/normalizing/matching/calculating/ready/failed) to a .pill modifier class, matching importStatusPillClass's clean/blocked/pending convention so the Runs and Batches tables read the same way at a glance. */
export function runStatusPillClass(status: string): string {
  return RUN_STATUS_PILL_CLASS[status] ?? "pending";
}

/** Plain-language explanation for each run status, shown as a title= tooltip -- the four in-progress stage names (validating/normalizing/matching/calculating) are pipeline-internal and otherwise unexplained. */
export const RUN_STATUS_TOOLTIPS: Record<string, string> = {
  validating: "The run is still checking the uploaded files -- in progress, refresh in a moment.",
  normalizing: "The run is still standardizing the vendor and Miva data for comparison -- in progress, refresh in a moment.",
  matching: "The run is still matching vendor rows to Miva products -- in progress, refresh in a moment.",
  calculating: "The run is still calculating proposed changes -- in progress, refresh in a moment.",
  ready: "The run finished processing and is ready to review.",
  failed: "The run failed to complete -- see the failure reason below.",
};
