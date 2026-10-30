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
    date: "2026-10-30",
    items: [
      "Fixed the \"An unexpected error occurred\" message when saving a vendor, such as setting Olliix's Discontinued threshold. The change itself was being saved, but the activity log entry for it failed and made the page report an error. Editing, adding and turning off vendors now saves cleanly.",
    ],
  },
  {
    date: "2026-10-29",
    items: [
      "The Catalog page can now export. \"Export view (CSV)\" downloads exactly what you're looking at (your visible columns and every row that matches your search and filters), and \"Download full snapshot\" saves the whole catalog file with every column. UPCs keep their leading zeros when opened in Excel.",
    ],
  },
  {
    date: "2026-10-28",
    items: [
      "You can now upload Olliix's \"Discontinued Items Notification\" file in the same Vendor Inventory Data box as every other vendor file. The app recognizes it on its own and adds those products to Olliix's running list of discontinued items. Uploading a newer list never removes anything already on it.",
      "On an Olliix run, a product on that list is shown as Discontinued in the Product phase column. Once its quantity drops below the Discontinued threshold it is proposed as NLA; above it, it stays live under the normal stock rules. Products are matched by UPC.",
      "A live Olliix product that is on the discontinued list but missing from the daily file is now proposed as NLA as a warning you approve individually. Products missing from the file that are not on the list are still blocked, as before.",
      "New Settings > Features page (admins only) with on/off switches for optional features. Saved Catalog views are off by default, so nothing changes on the Catalog until an admin turns them on there.",
      "The Catalog page now has saved Views. Set up the columns, column order and widths, filters and sort you want, then click Save as new view. Pick any saved view from the View dropdown to switch to it in one click. (Off until an admin enables it in Settings > Features.)",
      "Views are private to you until you choose Share with the team. Only the person who made a shared view (or an admin) can change it; everyone else can save their own copy. You can make any view your own default from the ... menu, and an admin can set the team default.",
      "The Catalog now shows a line above the table describing the filters and sort in effect, so you can always see why rows are hidden.",
      "The Catalog page has a new Vendor column next to Brand. Filter it to a vendor (for example Olliix) to see every product under all of that vendor's brands.",
      "Fixed the Manage Vendors edit form stretching wider than the screen. It now fits without sideways scrolling.",
      "Manage Vendors has a new \"Discontinued threshold\" setting for each vendor (leave it blank to turn it off). Olliix starts with it off, so nothing changes for Olliix runs until you set a number.",
    ],
  },
  {
    date: "2026-10-25",
    items: [
      "Gobi Heat's new inventory report (with the Product Phase column) now uploads, and the old format still works. If a required column ever can't be recognized, the upload stops with a clear message instead of guessing.",
      "Gobi products marked End of Life or Discontinued with fewer than 10 units are now proposed as NLA (taken out of rotation). At 10 or more units they follow the normal stock rules (6+ in stock, 5 and under sold out) so they stay live while inventory lasts. Active products work as before.",
      "If a product is already NLA in Miva but Gobi's file says it should be live, it shows as a warning that needs your individual approval. Approving it puts it back in stock with the normal tracking values.",
      "A live Gobi product in Miva that is missing from Gobi's file entirely now shows as a warning that proposes NLA (approve it individually) instead of a hard block.",
      "Gobi products that are already set up correctly as NLA no longer show up as warnings; they appear as unchanged.",
      "Dropship Inventory Management now has two new options in Miva: 2 keeps managing inventory like 1 but always keeps the product off the shopping feed (availability and datafeed blank, shopping feed Exclude), and 3 hides the product from reconciliation runs completely, so it never shows up as a row, warning or exception.",
      "The Excel version of the vendor exception report now opens as a formatted table (colored header with filter buttons, banded rows, frozen header row, sized columns).",
      "Fixed the vendor exception report not including any warnings: warning rows now export, with new options for Miva status warnings (already NLA, not tracked, parent inactive) and unrecognized product phase. The report also now includes every column from Run Review (outcome, class, proposed status and restock, product phase, changed fields, decision).",
      "Run Review has a new \"Product phase\" column (Active, End of Life, Discontinued) for vendors whose file includes one, so you can see why a product is being proposed as NLA. Runs created before this update won't show a phase.",
    ],
  },
  {
    date: "2026-10-19",
    items: [
      "If Miva already shows a product as in-house tracked (its built-in inventory tracking is on with a real stock count), reconciliation now blocks that row from being approved instead of letting a vendor update overwrite it -- it still shows up in the run for visibility, just marked blocked. It goes back to normal as soon as Miva's tracking is turned off for that product.",
      "Catalog page: the \"Stock level\" column now shows \"N/A\" for products where Miva's built-in inventory tracking is off, instead of a misleading 0. The separate \"Track inventory\" column was removed since Stock level now shows that on its own.",
    ],
  },
  {
    date: "2026-10-16",
    items: [
      "Added a banner at the top of every page showing whether you're on the Live or Development Miva store -- green for Live, red for Development, so it can't be missed or confused for the other. Admins also see a \"Switch connection\" link on the banner that jumps straight to the Miva Connection settings page.",
      "The instructions card at the top of every page, and the Changelog on the Settings page, now start collapsed instead of expanded -- click to expand either one, and your choice is remembered next time.",
      "Batch email report: the Live/Development store is now shown as a hard-to-miss colored banner (and in the subject line), the \"View Run\"/\"View Batch\" buttons are now different colors, and each Clean/Updated/Warning/Skipped line now has a \"View these rows\" link that opens Run Review pre-filtered to that set.",
      "Added an idle-timeout sign-out: after a set number of minutes of inactivity, you'll see a 60-second warning with a \"Stay signed in\" button before being signed out automatically. New Settings > Session Timeout page lets an admin change how many minutes that is.",
      "Fixed the app sometimes going \"stale\" after sitting open for a while -- it now notices right away when your session has ended and takes you to the sign-in page, instead of looking signed in but not working until you refresh.",
      "Fixed the batch email report's \"Skipped\" count sometimes showing a number larger than the total rows in the run.",
      "Fixed a link from an email (View Run / View Batch) opened while signed out: signing in now takes you straight to that page instead of the home page.",
    ],
  },
  {
    date: "2026-10-15",
    items: [
      "Added automatic email reports: whenever a batch is pushed or rolled back to Miva, an email summarizes what was clean, updated, flagged with a warning, or skipped, with links back to the run and the batch.",
      "New Settings > Email Reports page lets you choose who receives these emails and turn them on or off.",
      "Home page and Catalog page now only show Miva snapshots pulled from the currently active site (Development or Live) in their dropdowns -- no more accidentally picking a Live pull while Development is active, or vice versa. Visible snapshots show a \"Dev\" or \"Live\" tag.",
    ],
  },
  {
    date: "2026-10-14",
    items: [
      "Every timestamp in the app (Catalog, Run History, Run Review, Activity Log, and more) now always shows Eastern time, so everyone sees the same clock time no matter their own timezone.",
      "Added a new warning for a matched product whose parent item is inactive in Miva, even if the product itself still shows stock.",
      "Run Review's Warnings/Blockers column now shows each warning or blocker as its own colored tag instead of one long comma-separated list.",
      "Run Review toolbar cleanup: removed an unused approve-all button and all reject buttons (use \"Reset to pending\" instead), and \"Generate batch\" now looks visually distinct from \"Approve all clean.\"",
    ],
  },
  {
    date: "2026-10-13",
    items: [
      "Manage Vendors: added a new matching option, \"Both (UPC + SKU)\", for vendors whose file reliably provides both -- checks each independently and only blocks for review if they disagree, instead of relying on just one.",
      "Run Review: added a \"Show all Miva products\" checkbox to browse every product under this vendor's brand, including ones not currently matched or flagged -- informational only, never approvable.",
      "Added a new warning for a match where Miva's status already says a product is \"No longer available,\" even when its tracked flag is set correctly -- previously this could slip through as a plain, bulk-approvable match.",
    ],
  },
  {
    date: "2026-10-12",
    items: [
      "Run Review: added a new summary tile showing how many Miva products exist under this vendor's brand, regardless of tracked status.",
      "Run Review: simplified the filter row -- \"Changed only\" is gone (Review class now defaults to Clean+Warning instead), and the Decision filter is down to Pending/Approved/Rejected. Added tooltips throughout, including on the Decision and Item No/UPC-SKU columns.",
      "Renamed \"NLA (Miva only)\" to \"Miva only\" to stop it being confused with Miva's own NLA field value -- now explained separately in the Glossary.",
    ],
  },
  {
    date: "2026-10-09",
    items: [
      "Manage Vendors: added the Acme Test Brand test vendor and the TechNiche International (Occunomix) placeholder vendor, available in every environment.",
      "Fixed a matching regression where vendors could show far fewer matches than expected -- a product whose Miva tracked-flag wasn't set to 1 now shows up as a warning requiring your review instead of being silently invisible, with a one-click \"Approve all (blank tracked-flag only)\" action to clear a backlog of these at once.",
      "Fixed Audits & Reviews: the \"Select legacy audit\" dropdown could silently stay empty after a successful upload with no error shown -- failures are now shown on screen.",
    ],
  },
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
