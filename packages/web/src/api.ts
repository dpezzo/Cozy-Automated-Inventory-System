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

  listUsers: () => request<UserAccount[]>("/users"),
  createUser: (input: { email: string; role: "admin" | "member"; displayName?: string; password?: string }) =>
    request<UserAccount>("/users", { method: "POST", body: JSON.stringify(input) }),
  updateUser: (id: string, patch: Partial<{ role: "admin" | "member"; isActive: boolean; displayName: string | null }>) =>
    request<UserAccount>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
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
    return body as { file: FileRecord; detectedVendorLabel: string; duplicateWarning: string | null };
  },
  getCatalogRows: (fileId: string) => request<MivaCatalogRow[]>(`/files/${fileId}/catalog-rows`),

  getMivaApiStatus: () => request<{ configured: boolean; environment: "development" | "production" }>("/miva/api-status"),
  pullMivaSnapshot: () =>
    request<{ file: FileRecord; duplicateWarning: string | null }>("/miva/pull-snapshot", { method: "POST" }),

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
    request(`/runs/${runId}/decisions/bulk`, { method: "POST", body: JSON.stringify({ rowIds, decision }) }),
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
  currentReportFlag: string;
  productType?: string;
  productUrl?: string;
  thumbnailUrl?: string;
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

export interface FileRecord {
  id: string;
  kind: string;
  originalFilename: string;
  checksumSha256: string;
  sizeBytes: number;
  rowCount: number | null;
  uploadedAt: string;
  vendorKey: string | null;
}

export interface GenericCsvColumnMapping {
  identifierColumn: string;
  identifierType: "upc" | "sku";
  descriptionColumn?: string;
  quantityColumn: string;
}

export interface VendorConfig {
  vendorKey: string;
  vendorLabel: string;
  inStockThreshold: number;
  timezone: string;
  brandAllowlist: string[];
  matchStrategy: "upc-to-gtin" | "sku-to-mpn";
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
  matchStrategy: "upc-to-gtin" | "sku-to-mpn";
}

export type CreateVendorInput =
  | (CreateVendorCommon & { fileShape: "simple_csv"; columnMapping: GenericCsvColumnMapping })
  | (CreateVendorCommon & { fileShape: "plugin"; pluginFilename: string });

export interface UpdateVendorInput {
  vendorLabel?: string;
  inStockThreshold?: number;
  timezone?: string;
  brandAllowlist?: string[];
  matchStrategy?: "upc-to-gtin" | "sku-to-mpn";
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
  changed: number;
  unchanged: number;
}

export interface ManagedValuesView {
  simpleInventory?: string;
  availability?: string;
  restockMessage?: string;
  dataFeed?: string;
  shoppingFeed?: string;
  reportFlag?: string;
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
}

export interface LegacyComparisonRow {
  source_row_number: number | null;
  product_code: string | null;
  comparison_class: string;
  deviation_id: string | null;
  note: string;
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
