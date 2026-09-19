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
 * Every vendor's inventory-file FileKind + display label. This is the one
 * place the web app's vendor tabs and "vendor file" dropdown are driven from
 * -- adding a vendor here is the only web-side change needed for a new one
 * to show up, once its FileKind/parser exist server-side (see
 * packages/shared/src/vendorRegistry.ts and
 * packages/server/src/vendor/vendorFileRegistry.ts for the matching
 * server-side registry).
 */
export const VENDOR_FILE_DEFS = [
  {
    kind: "olliix_workbook",
    label: "Olliix",
    uploadLabel: "Upload Olliix workbook (.xlsx)",
    hint: "The current Olliix 'Item Inventory' export.",
  },
  {
    kind: "kh_workbook",
    label: "K&H Pet Products",
    uploadLabel: "Upload K&H inventory (.csv)",
    hint: "The K&H distributor CSV export -- automatically filtered to K&H Pet Products rows only.",
  },
  {
    kind: "gobi_workbook",
    label: "Gobi Heat",
    uploadLabel: "Upload Gobi inventory (.xlsx)",
    hint: "The Gobi Heat 'Custom Main Inventory Report' export.",
  },
  {
    kind: "fieldsheer_workbook",
    label: "FieldSheer/MobileWarming",
    uploadLabel: "Upload FieldSheer/MobileWarming inventory (.csv)",
    hint: "The FieldSheer/MobileWarming inventory export.",
  },
] as const;

export const api = {
  login: (email: string, password: string) =>
    request<{ id: string; email: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request<{ id: string; email: string }>("/auth/me"),

  listFiles: (kind?: string) => request<FileRecord[]>(`/files${kind ? `?kind=${kind}` : ""}`),
  /** Every uploaded/pulled file across all vendor FileKinds, newest first -- what Step 3's vendor-file dropdown lists. */
  listVendorFiles: async (): Promise<FileRecord[]> => {
    const perVendor = await Promise.all(VENDOR_FILE_DEFS.map((v) => request<FileRecord[]>(`/files?kind=${v.kind}`)));
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
  createRun: (vendorFileId: string, mivaFileId: string) =>
    request<RunRecord>("/runs", { method: "POST", body: JSON.stringify({ vendorFileId, mivaFileId }) }),
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
  pushBatchToMiva: (batchId: string, confirmProduction: boolean) =>
    request<PushBatchResult>(`/batches/${batchId}/push-to-miva`, {
      method: "POST",
      body: JSON.stringify({ confirmProduction }),
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

export interface FileRecord {
  id: string;
  kind: string;
  originalFilename: string;
  checksumSha256: string;
  sizeBytes: number;
  rowCount: number | null;
  uploadedAt: string;
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
