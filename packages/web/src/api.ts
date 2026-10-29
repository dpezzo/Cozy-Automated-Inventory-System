export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(body.message ?? "Request failed");
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  if (!res.ok) {
    let body: ApiError;
    try {
      body = await res.json();
    } catch {
      body = { error: "UNKNOWN", message: res.statusText };
    }
    // Distinct from a failed login attempt (INVALID_CREDENTIALS, handled by
    // LoginPage itself) -- this fires whenever requireAuth rejects an
    // already-in-flight request because the session cookie expired or was
    // destroyed server-side. AuthContext listens for it to clear `user`
    // immediately, instead of the UI silently staying "logged in" until a
    // manual refresh happens to notice. See also the idle-timeout warning,
    // which proactively signs out before this would ever fire.
    if (res.status === 401 && body.error === "AUTHENTICATION_REQUIRED") {
      window.dispatchEvent(new Event("session-expired"));
    }
    throw new ApiRequestError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * The 4 built-in ("custom" file_shape) vendors' fixed FileKind, keyed by
 * vendor_key. These never change at runtime -- each is backed by a
 * hand-written parser file, not a vendor_configs row's file_shape -- unlike
 * a dynamically-added ('simple_csv'/'plugin') vendor, whose uploaded files
 * always carry FileKind "vendor_dynamic" with FileRecord.vendorKey
 * identifying which vendor. Display labels/hints now come from
 * listVendorSummaries() (GET /vendors/summary) instead of being duplicated
 * here by hand.
 */
const BUILTIN_VENDOR_FILE_KINDS: Record<string, string> = {
  olliix: "olliix_workbook",
  kh: "kh_workbook",
  gobi: "gobi_workbook",
  fieldsheer: "fieldsheer_workbook",
};

/** Every FileKind that represents a vendor inventory file -- the 4 fixed built-in kinds plus the one shared dynamic-vendor kind. */
export const VENDOR_FILE_KINDS: string[] = [...Object.values(BUILTIN_VENDOR_FILE_KINDS), "vendor_dynamic"];

/** Resolves a vendor file's display label from the current vendor list, for the built-in kinds or a dynamic vendor_key alike. */
export function vendorLabelForFile(file: FileRecord, vendors: VendorSummary[]): string {
  if (file.kind === "vendor_dynamic" && file.vendorKey) {
    return vendors.find((v) => v.vendorKey === file.vendorKey)?.vendorLabel ?? file.vendorKey;
  }
  const vendorKey = Object.entries(BUILTIN_VENDOR_FILE_KINDS).find(([, kind]) => kind === file.kind)?.[0];
  return vendors.find((v) => v.vendorKey === vendorKey)?.vendorLabel ?? file.kind;
}

export const api = {
  login: (email: string, password: string) =>
    request<AuthUserView>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  loginWithGoogle: (credential: string) =>
    request<AuthUserView>("/auth/google", { method: "POST", body: JSON.stringify({ credential }) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request<AuthUserView>("/auth/me"),
  getAuthConfig: () => request<{ googleClientId: string | null }>("/auth/config"),
  getHealth: () => request<{ status: string; dbDriver: string; commitSha: string | null }>("/health"),
  getReleaseNotes: () => request<ReleaseNoteEntry[]>("/release-notes"),

  listUsers: () => request<UserAccount[]>("/users"),
  listAuditLog: (limit?: number) => request<AuditLogRecord[]>(`/audit-log${limit ? `?limit=${limit}` : ""}`),
  previewClearData: (scope: ClearDataScope) =>
    request<ClearDataCounts>("/admin/clear-data/preview", { method: "POST", body: JSON.stringify({ scope }) }),
  clearData: (scope: ClearDataScope) =>
    request<ClearDataResult>("/admin/clear-data", { method: "POST", body: JSON.stringify({ scope, confirm: true }) }),

  getDataStats: () => request<DataStats>("/data-stats"),
  setDataSizeAlertThresholds: (thresholds: DataSizeAlertThresholds) =>
    request<DataStats>("/admin/data-size-alert-thresholds", { method: "PUT", body: JSON.stringify(thresholds) }),
  resetDataSizeAlertThresholds: () => request<DataStats>("/admin/data-size-alert-thresholds", { method: "DELETE" }),
  createUser: (input: { email: string; role: "admin" | "member"; displayName?: string; password?: string }) =>
    request<UserAccount>("/users", { method: "POST", body: JSON.stringify(input) }),
  updateUser: (
    id: string,
    patch: Partial<{ email: string; role: "admin" | "member"; isActive: boolean; displayName: string | null; password: string }>,
  ) => request<UserAccount>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteUser: (id: string) => request(`/users/${id}`, { method: "DELETE" }),

  // Admin-only full vendor config CRUD (Manage Vendors page).
  listVendors: () => request<VendorConfig[]>("/vendors"),
  createVendor: (input: CreateVendorInput) => request<VendorConfig>("/vendors", { method: "POST", body: JSON.stringify(input) }),
  updateVendor: (key: string, patch: UpdateVendorInput) =>
    request<VendorConfig>(`/vendors/${key}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteVendor: (key: string) => request(`/vendors/${key}`, { method: "DELETE" }),
  listAvailablePluginFiles: () => request<string[]>("/vendors/available-plugin-files"),
  reloadPlugins: () => request<{ ok: true }>("/vendors/reload-plugins", { method: "POST" }),
  /** Non-admin-safe minimal vendor list -- every signed-in user needs this to label/pick vendor files on the Home page, unlike the full config in listVendors(). */
  listVendorSummaries: () => request<VendorSummary[]>("/vendors/summary"),
  /** Deduped brand names across every active vendor's allowlist -- used to default the Miva Catalog page to "our vendors' brands only." */
  listActiveVendorBrands: () => request<string[]>("/vendors/active-brands"),
  /** Each active vendor with its brand allowlist -- lets the Catalog show which vendor carries a product's brand. */
  listVendorBrandGroups: () => request<{ vendorKey: string; vendorLabel: string; brands: string[] }[]>("/vendors/brand-groups"),

  listFiles: (kind?: string) => request<FileRecord[]>(`/files${kind ? `?kind=${kind}` : ""}`),
  /** Every uploaded/pulled file across all vendor FileKinds, newest first -- what Step 3's vendor-file dropdown lists. */
  listVendorFiles: async (): Promise<FileRecord[]> => {
    const perVendor = await Promise.all(VENDOR_FILE_KINDS.map((kind) => request<FileRecord[]>(`/files?kind=${kind}`)));
    return perVendor.flat().sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  },
  uploadFile: async (file: File, kind: string, confirmDuplicate = false) => {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    form.append("confirmDuplicate", String(confirmDuplicate));
    const res = await fetch("/api/files", { method: "POST", body: form, credentials: "include" });
    const body = await res.json();
    if (!res.ok) throw new ApiRequestError(res.status, body);
    return body as { file: FileRecord; duplicateWarning: string | null };
  },
  downloadFileUrl: (id: string) => `/api/files/${id}/download`,
  /** Uploads a vendor inventory file without specifying which vendor -- detected server-side from the file's own content. */
  uploadVendorFile: async (file: File, confirmDuplicate = false) => {
    const form = new FormData();
    form.append("file", file);
    form.append("confirmDuplicate", String(confirmDuplicate));
    const res = await fetch("/api/files/vendor-auto-detect", { method: "POST", body: form, credentials: "include" });
    const body = await res.json();
    if (!res.ok) throw new ApiRequestError(res.status, body);
    return body as {
      file: FileRecord;
      detectedVendorLabel: string;
      /** Set only when the upload was a "Discontinued Items Notification", which is merged into the vendor's discontinued list instead of becoming a run input. Null if it was an unconfirmed duplicate. */
      discontinuedImport: { added: number; updated: number; skipped: number } | null;
      duplicateWarning: string | null;
    };
  },
  /** App-wide on/off switches (Settings > Features). Every signed-in user can read them; only an admin can change them. */
  getFeatures: () => request<FeatureFlags>("/features"),
  setFeatures: (patch: Partial<FeatureFlags>) =>
    request<FeatureFlags>("/admin/features", { method: "PUT", body: JSON.stringify(patch) }),
  listCatalogViews: () => request<CatalogViewsPayload>("/catalog-views"),
  createCatalogView: (input: { name: string; isShared: boolean; config: CatalogViewConfig }) =>
    request<CatalogViewDto>("/catalog-views", { method: "POST", body: JSON.stringify(input) }),
  updateCatalogView: (id: string, patch: { name?: string; isShared?: boolean; config?: CatalogViewConfig }) =>
    request<CatalogViewDto>(`/catalog-views/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteCatalogView: (id: string) => request(`/catalog-views/${id}`, { method: "DELETE" }),
  /** scope "team" is admin-only; viewId null clears that default. */
  setCatalogViewDefault: (scope: "personal" | "team", viewId: string | null) =>
    request(`/catalog-views/default`, { method: "PUT", body: JSON.stringify({ scope, viewId }) }),
  getCatalogRows: (fileId: string) => request<MivaCatalogRow[]>(`/files/${fileId}/catalog-rows`),

  getMivaApiStatus: () =>
    request<{ configured: boolean; environment: "development" | "production"; activeSite: "development" | "live" }>(
      "/miva/api-status",
    ),
  setMivaActiveSite: (site: "development" | "live") =>
    request<{ activeSite: "development" | "live"; configured: boolean; environment: "development" | "production" }>(
      "/admin/miva-active-site",
      { method: "PUT", body: JSON.stringify({ site }) },
    ),
  pullMivaSnapshot: () =>
    request<{ file: FileRecord; duplicateWarning: string | null }>("/miva/pull-snapshot", { method: "POST" }),

  getReportSettings: () => request<{ email: string; enabled: boolean }>("/admin/report-settings"),
  setReportSettings: (email: string, enabled: boolean) =>
    request<{ email: string; enabled: boolean }>("/admin/report-settings", {
      method: "PUT",
      body: JSON.stringify({ email, enabled }),
    }),

  getSessionConfig: () => request<{ idleTimeoutMinutes: number }>("/session-config"),
  setIdleTimeoutMinutes: (idleTimeoutMinutes: number) =>
    request<{ idleTimeoutMinutes: number }>("/admin/session-config", {
      method: "PUT",
      body: JSON.stringify({ idleTimeoutMinutes }),
    }),

  getDevResetReference: () => request<{ file: FileRecord | null }>("/admin/dev-reset/reference"),
  uploadDevResetReference: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/admin/dev-reset/reference", { method: "POST", body: form, credentials: "include" });
    const body = await res.json();
    if (!res.ok) throw new ApiRequestError(res.status, body);
    return body as { fileId: string; rowCount: number };
  },
  runDevReset: () => request<PushBatchResult>("/admin/dev-reset", { method: "POST" }),

  listRuns: () => request<RunRecord[]>("/runs"),
  createRun: (vendorFileId: string, mivaFileId: string, confirmDuplicate = false) =>
    request<RunRecord>("/runs", {
      method: "POST",
      body: JSON.stringify({ vendorFileId, mivaFileId, confirmDuplicate }),
    }),
  getRun: (id: string) => request<{ run: RunRecord; summary: RunSummary | null }>(`/runs/${id}`),
  getRunRows: (id: string, params: Record<string, string>) =>
    request<ReviewRowView[]>(`/runs/${id}/rows?${new URLSearchParams(params).toString()}`),
  approveAllClean: (runId: string) => request<{ approved: number }>(`/runs/${runId}/decisions/approve-all-clean`, { method: "POST" }),
  bulkDecision: (runId: string, rowIds: string[], decision: "APPROVED" | "REJECTED") =>
    request<{ applied: number; skipped: string[] }>(`/runs/${runId}/decisions/bulk`, {
      method: "POST",
      body: JSON.stringify({ rowIds, decision }),
    }),
  setDecision: (runId: string, rowId: string, decision: string) =>
    request(`/runs/${runId}/decisions/${rowId}`, { method: "POST", body: JSON.stringify({ decision }) }),
  batchableCount: (runId: string) => request<{ count: number }>(`/runs/${runId}/batchable-count`),
  generateBatch: (runId: string) => request<BatchRecord>(`/runs/${runId}/batches`, { method: "POST" }),
  listRunBatches: (runId: string) => request<BatchRecord[]>(`/runs/${runId}/batches`),
  runLegacyComparison: (runId: string, legacyFileId: string) =>
    request<{ comparisonId: string; rows: LegacyComparisonRow[] }>(`/runs/${runId}/legacy-comparison`, {
      method: "POST",
      body: JSON.stringify({ legacyFileId }),
    }),
  listLegacyComparisons: (runId: string) => request<{ id: string; created_at: string }[]>(`/runs/${runId}/legacy-comparisons`),
  generateVendorExceptionReport: (runId: string, categories: string[], format: "csv" | "xlsx") =>
    request<FileRecord>(`/runs/${runId}/vendor-exception-report`, {
      method: "POST",
      body: JSON.stringify({ categories, format }),
    }),

  listBatches: () => request<BatchRecord[]>("/batches"),
  getBatch: (id: string) => request<BatchRecord>(`/batches/${id}`),
  pushBatchToMiva: (batchId: string, confirmProduction: boolean, target: "update" | "rollback" = "update") =>
    request<PushBatchResult>(`/batches/${batchId}/push-to-miva`, {
      method: "POST",
      body: JSON.stringify({ confirmProduction, target }),
    }),
  setImportOutcome: (id: string, status: string) =>
    request(`/batches/${id}/import-outcome`, { method: "POST", body: JSON.stringify({ status }) }),
  runPostImportVerification: (batchId: string, postImportFileId: string) =>
    request<{ verificationId: string; rows: VerificationRow[] }>(`/batches/${batchId}/post-import-verification`, {
      method: "POST",
      body: JSON.stringify({ postImportFileId }),
    }),
  listPostImportVerifications: (batchId: string) =>
    request<{ id: string; created_at: string }[]>(`/batches/${batchId}/post-import-verifications`),
};

/** Mirrors CatalogViewConfig in packages/shared/src/catalogView.ts (the web package doesn't import shared). */
export interface CatalogViewConfig {
  version: 1;
  hiddenColumns: string[];
  /** Empty means the page's default column order. */
  columnOrder: string[];
  columnWidths: Record<string, number>;
  /** Per column, the values that stay visible; a column with no entry is unfiltered. */
  columnFilters: Record<string, string[]>;
  sortKey: string | null;
  sortDir: "asc" | "desc";
  vendorBrandsOnly: boolean;
}

export interface FeatureFlags {
  catalogViews: boolean;
}

export interface CatalogViewDto {
  id: string;
  name: string;
  ownerUserId: string;
  ownerLabel: string;
  isShared: boolean;
  isMine: boolean;
  /** The owner or an admin. */
  canEdit: boolean;
  config: CatalogViewConfig;
  updatedAt: string;
}

export interface CatalogViewsPayload {
  views: CatalogViewDto[];
  builtins: { id: string; name: string; config: CatalogViewConfig }[];
  defaults: { personal: string | null; team: string | null };
}

export interface MivaCatalogRow {
  sourceRowNumber: number;
  productCode: string;
  productName: string;
  gtinRaw: string | null;
  mpnRaw: string | null;
  brandRaw: string | null;
  currentSimpleInventory: string;
  currentAvailability: string;
  currentRestockMessage: string;
  currentDataFeed: string;
  currentShoppingFeed: string;
  currentDsInvMgt: string;
  productType?: string;
  productUrl?: string;
  thumbnailUrl?: string;
  active?: string;
  parentCode?: string;
  currentStockLevel?: string;
  trackInventory?: string;
  /** Not from the server: the Catalog page fills this with the active vendor(s) whose brand allowlist contains this row's brand. */
  vendorLabels?: string;
}

export interface AuthUserView {
  id: string;
  email: string;
  role: "admin" | "member";
}

export interface UserAccount {
  id: string;
  email: string;
  role: "admin" | "member";
  displayName: string | null;
  isActive: boolean;
}

export interface ReleaseNoteEntry {
  date: string;
  items: string[];
}

export interface FileRecord {
  id: string;
  kind: string;
  originalFilename: string;
  checksumSha256: string;
  sizeBytes: number;
  rowCount: number | null;
  uploadedAt: string;
  vendorKey: string | null;
  sourceSite: "development" | "live" | null;
}

export interface GenericCsvColumnMapping {
  identifierColumn: string;
  identifierType: "upc" | "sku";
  /** Only used when matchStrategy is "upc-or-sku" -- the column for the OTHER identifier. */
  secondaryIdentifierColumn?: string;
  descriptionColumn?: string;
  quantityColumn: string;
}

export interface VendorConfig {
  vendorKey: string;
  vendorLabel: string;
  inStockThreshold: number;
  /** Units below which a discontinued product becomes NLA; null = lifecycle-aware NLA handling is off for this vendor. */
  discontinuedThreshold: number | null;
  timezone: string;
  brandAllowlist: string[];
  matchStrategy: "upc-to-gtin" | "sku-to-mpn" | "upc-or-sku";
  missingBlockerCode: string | null;
  fileShape: "custom" | "simple_csv" | "plugin";
  columnMapping: GenericCsvColumnMapping | null;
  pluginFilename: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What every signed-in user (not just admins) can see about a vendor -- enough to label vendor files, nothing about tunables. */
export interface VendorSummary {
  vendorKey: string;
  vendorLabel: string;
  fileShape: "custom" | "simple_csv" | "plugin";
  isActive: boolean;
}

interface CreateVendorCommon {
  vendorKey: string;
  vendorLabel: string;
  inStockThreshold: number;
  timezone: string;
  brandAllowlist: string[];
  matchStrategy: "upc-to-gtin" | "sku-to-mpn" | "upc-or-sku";
}

export type CreateVendorInput =
  | (CreateVendorCommon & { fileShape: "simple_csv"; columnMapping: GenericCsvColumnMapping })
  | (CreateVendorCommon & { fileShape: "plugin"; pluginFilename: string });

export interface UpdateVendorInput {
  vendorLabel?: string;
  inStockThreshold?: number;
  /** null turns lifecycle-aware NLA handling off. */
  discontinuedThreshold?: number | null;
  timezone?: string;
  brandAllowlist?: string[];
  matchStrategy?: "upc-to-gtin" | "sku-to-mpn" | "upc-or-sku";
  columnMapping?: GenericCsvColumnMapping;
}

export interface RunRecord {
  id: string;
  vendorFileId: string;
  mivaFileId: string;
  ruleId: string;
  ruleConfigHash: string;
  runDate: string;
  status: string;
  failureReason: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface RunSummary {
  total: number;
  byReviewClass: Record<string, number>;
  byDecisionStatus: Record<string, number>;
  byMatchOutcome: Record<string, number>;
  changed: number;
  unchanged: number;
  mivaBrandTotal: number | null;
}

export interface ManagedValuesView {
  simpleInventory?: string;
  availability?: string;
  restockMessage?: string;
  dataFeed?: string;
  shoppingFeed?: string;
  dsInvMgt?: string;
}

export interface ReconciliationRowView {
  id: string;
  runId: string;
  sourceRowNumber: number | null;
  itemNo: string | null;
  rawUpc: string | null;
  normalizedUpc: string | null;
  description: string | null;
  productCode: string | null;
  matchOutcome: string;
  reviewClass: string;
  warningCodes: string[];
  blockerCodes: string[];
  totalQtyRaw: string | null;
  expectedDate: string | null;
  expectedDateSources: string[];
  current: ManagedValuesView;
  proposed: ManagedValuesView;
  changed: boolean;
  isEligibleForApproval: boolean;
  /** Vendor-reported lifecycle text (e.g. Gobi's Product Phase), when the vendor file has one. */
  productPhase?: string | null;
}

export interface DecisionView {
  id: string;
  reconciliationRowId: string;
  runId: string;
  status: "PENDING" | "APPROVED" | "APPROVED_WARNING_ACK" | "REJECTED";
  warningsAtDecision: string[];
  decidedAt: string | null;
  batchId: string | null;
  locked: boolean;
}

export interface ReviewRowView {
  row: ReconciliationRowView;
  decision: DecisionView;
}

export interface BatchRecord {
  id: string;
  runId: string;
  updateFileId: string | null;
  rollbackFileId: string | null;
  exceptionFileId: string | null;
  reconciliationFileId: string | null;
  importStatus: string;
  createdAt: string;
  rolledBackAt: string | null;
}

export interface DataSizeAlertThresholds {
  reconciliationRows: number;
  totalFileBytes: number;
}

export interface DataStats {
  reconciliationRows: number;
  totalFileBytes: number;
  thresholds: DataSizeAlertThresholds;
}

export interface ClearDataScope {
  runHistory: boolean;
  runHistoryBeforeDate: string | null;
  catalog: boolean;
  activityLog: boolean;
}

export interface ClearDataCounts {
  runs: number;
  batches: number;
  reconciliationRows: number;
  decisions: number;
  legacyComparisons: number;
  postImportVerifications: number;
  files: number;
  totalFileBytes: number;
  activityLogEntries: number;
}

export interface ClearDataResult extends ClearDataCounts {
  deletedFileStoragePaths: string[];
}

export interface AuditLogRecord {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface LegacyComparisonValues {
  simpleInventory: string | null;
  availability: string | null;
  restockMessage: string | null;
  dataFeed: string | null;
  shoppingFeed: string | null;
  dsInvMgt: string | null;
  expectedDate: string | null;
}

export interface LegacyComparisonRow {
  source_row_number: number | null;
  product_code: string | null;
  item_no: string | null;
  raw_upc: string | null;
  item_name: string | null;
  comparison_class: string;
  deviation_id: string | null;
  note: string;
  our_values: LegacyComparisonValues | null;
  legacy_values: LegacyComparisonValues | null;
  miva_values: LegacyComparisonValues | null;
}

export interface VerificationRow {
  product_code: string;
  result: "PASS" | "FAIL";
  reason: string;
}

export interface PushRowResult {
  productCode: string;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface PushBatchResult {
  pushed: number;
  failed: number;
  verificationMismatches: number;
  results: PushRowResult[];
}
