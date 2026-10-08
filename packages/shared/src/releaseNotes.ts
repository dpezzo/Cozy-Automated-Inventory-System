export interface ReleaseNoteEntry {
  /** YYYY-MM-DD. The newest entry's date is also shown as the app's version number (reformatted as YYYY.MM.DD). */
  date: string;
  items: string[];
}

/**
 * Short, plain-language release notes for the Settings page -- written for the people
 * using the app, not the people building it (no file names, no root-cause explanations;
 * see app/CHANGELOG.md for that level of detail). Newest entry first. Append a new entry
 * here, dated today, as part of each shipped change going forward.
 */
export const RELEASE_NOTES: ReleaseNoteEntry[] = [
  {
    date: "2026-10-08",
    items: [
      "The Home page is now permanently named \"Inventory Update\" (previously a preview toggle between \"Home\" and \"Run Reconciliation\"), to describe what it actually does for anyone new to the app.",
      "A small badge in the sidebar now always shows whether you're pointed at the Dev or the LIVE Miva store.",
      "Clear Data redesigned: choose \"Clear all\" or pick exactly what to clear -- Run History, Miva Catalog (previously missed entirely if a snapshot was never used in a run), and optionally the Activity Log.",
    ],
  },
  {
    date: "2026-10-07",
    items: [
      "Miva Connection: switching the active site now requires clicking Save and confirming, instead of applying instantly, to prevent an accidental switch from breaking the catalog pull button.",
      "Miva Catalog: added Active (shown as Yes/No, matching Miva) and Parent Code columns, and a 'Vendor brands only' toggle that defaults the catalog to just your active vendors' brands.",
      "Settings: added this version number and changelog, plus a direct link to the Activity Log.",
      "Activity Log: now its own page (reached from Settings) with its own title and icon, instead of a tab that was easy to mistake for Audits & Reviews.",
      "Settings: Manage Users, Manage Vendors, Clear Data, and Miva Connection all now have a consistent 'Back to settings' link placed the same way.",
      "Miva Connection: Reset dev site products now only appears while Development is the active site, and its reference-file upload accepts a drag anywhere in that section instead of just the small upload box.",
      "Miva Catalog: columns can now be dragged into any order, with a Reset column order button if you want to put them back.",
    ],
  },
  {
    date: "2026-10-04",
    items: [
      "Renamed the internal 'Show in Darren Inventory Report' field to 'Dropship Inventory Management' everywhere it appears.",
      "Reconciliation now only processes products actually tracked for dropship inventory, instead of scanning the entire catalog.",
      "Added the Miva Connection page: switch between the Development and Live Miva store, and reset the dev store's products to a known baseline for testing.",
    ],
  },
  {
    date: "2026-09-24",
    items: [
      "Added plain-language explanations and tooltips throughout the app (statuses, vendor settings, run review columns, and more).",
      "Unified on \"snapshot\" as the term for a Miva catalog file, instead of a mix of \"snapshot\"/\"export\".",
      "Visual polish to the sidebar and page headers; dark mode toggle moved to a fixed button in the corner.",
      "Fixed the Run Review results table not resizing correctly on some screens.",
    ],
  },
  {
    date: "2026-09-23",
    items: [
      "Full visual restyle to match the CozyWinters brand, with a dark mode toggle.",
      "Added icons throughout the app for easier navigation.",
      "Friendlier error messages app-wide, plus confirmation dialogs before bulk actions (approve all, reject, generate batch, live push) and before deactivating a vendor or user.",
      "Added an in-app Glossary explaining common terms.",
    ],
  },
  {
    date: "2026-09-22",
    items: [
      "A batch's import status now updates itself automatically after a Miva push, instead of requiring a manual click.",
      "Run History and Run Review reorganized for clearer cross-linking between runs and batches.",
      "Legacy Comparison now shows a full field-by-field differences report.",
      "Added a new Vendor Exception Report you can export and send back to a vendor for clarification.",
    ],
  },
  {
    date: "2026-09-20",
    items: [
      "Added the Audits & Reviews page for one-time/periodic checks like legacy comparison.",
      "Added the admin Clear Data tool to permanently delete old runs/batches and free up space, with a preview before anything is deleted.",
      "Added a storage-size warning banner, shown app-wide once stored data grows too large.",
      "Admins can now edit a user's email, name, and password in place.",
      "Added the Activity Log -- an admin-only record of every significant action taken in the app.",
      "Added an \"Instructions\" card to every page explaining how to use it.",
      "Miva Catalog: added the original \"Pull latest catalog\" button and MPN search.",
    ],
  },
  {
    date: "2026-09-19",
    items: [
      "Added the ability to pull the Miva catalog directly from Miva's API, instead of only via manual file upload.",
      "Added the Miva Catalog browser page: search, filter, and sort the full catalog, with resizable and hideable columns.",
      "Added support for K&H Pet Products, Gobi Heat, and FieldSheer/Mobile Warming vendors, with automatic vendor detection from the uploaded file.",
      "Added \"Push to Miva via API\" directly from a batch, with automatic verification that the push actually took effect.",
      "Home page redesigned into a clear numbered Step 1/2/3 walkthrough.",
    ],
  },
  {
    date: "2026-09-18",
    items: [
      "Initial release: upload vendor and Miva files, review and approve changes, generate update/rollback files, compare against the legacy system, and verify after import.",
    ],
  },
];
