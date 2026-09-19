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

export const api = {
  login: (email: string, password: string) =>
    request<{ id: string; email: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request<{ id: string; email: string }>("/auth/me"),

  listFiles: (kind?: string) => request<FileRecord[]>(`/files${kind ? `?kind=${kind}` : ""}`),
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

  listRuns: () => request<RunRecord[]>("/runs"),
  createRun: (olliixFileId: string, mivaFileId: string) =>
    request<RunRecord>("/runs", { method: "POST", body: JSON.stringify({ olliixFileId, mivaFileId }) }),
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
  olliixFileId: string;
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
