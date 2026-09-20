import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { verifyCredentials, requireAuth, getLoginLockoutRemainingMs, recordFailedLogin, clearLoginAttempts } from "./auth";
import { getRepository, type RowFilter, type FileKind } from "./db";
import { readStoredFile, readStoredFileText } from "./storage/fileStorage";
import { uploadFile, uploadVendorFileAutoDetect } from "./domain/uploadService";
import { pullMivaSnapshotFromApi } from "./miva/mivaProducts";
import { isMivaApiConfigured } from "./miva/mivaApiClient";
import { parseMivaSnapshotCsv } from "./vendor/mivaCsv";
import { createRun, getRunSummary, approveAllClean, setRowDecision, bulkDecision, getBatchableRows } from "./domain/runService";
import { generateBatch } from "./domain/batchService";
import { runLegacyComparison } from "./domain/legacyService";
import { runPostImportVerification } from "./domain/verificationService";
import { pushBatchToMiva } from "./miva/mivaApiPush";
import { ValidationError, ForbiddenError, NotFoundError } from "./errors";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

export const router = Router();

function asyncHandler(fn: (req: import("express").Request, res: import("express").Response) => Promise<void>) {
  return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    fn(req, res).catch(next);
  };
}

// ---------- Auth ----------

function regenerateSession(req: import("express").Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

router.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: "INVALID_REQUEST", message: "Email and password are required." });
      return;
    }
    const lockoutRemainingMs = getLoginLockoutRemainingMs(email);
    if (lockoutRemainingMs !== null) {
      res.status(429).json({
        error: "TOO_MANY_ATTEMPTS",
        message: "Too many failed login attempts. Try again in a few minutes.",
      });
      return;
    }
    const user = await verifyCredentials(email, password);
    if (!user) {
      recordFailedLogin(email);
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Incorrect email or password." });
      return;
    }
    clearLoginAttempts(email);
    // Regenerate the session on login so a session ID established before
    // authentication (e.g. one an attacker fixed via cookie injection) can
    // never become an authenticated session -- only a freshly-issued ID can.
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.email = user.email;
    res.json({ id: user.id, email: user.email });
  }),
);

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/auth/me", (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "AUTHENTICATION_REQUIRED" });
    return;
  }
  res.json({ id: req.session.userId, email: req.session.email });
});

router.use(requireAuth);

// ---------- Files ----------

router.get(
  "/files",
  asyncHandler(async (req, res) => {
    const kind = req.query.kind as FileKind | undefined;
    const files = await getRepository().listFiles(kind);
    res.json(files);
  }),
);

router.post(
  "/files",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const kind = req.body.kind as FileKind;
    const confirmDuplicate = req.body.confirmDuplicate === "true";
    if (!req.file) {
      res.status(400).json({ error: "FILE_REQUIRED", message: "No file was uploaded." });
      return;
    }
    const result = await uploadFile(req.file.buffer, req.file.originalname, kind, req.session.userId!, confirmDuplicate);
    res.status(result.duplicateOf && !confirmDuplicate ? 200 : 201).json({
      file: result.file,
      duplicateWarning: result.duplicateOf
        ? `An identical ${kind} file was already uploaded on ${result.duplicateOf.uploadedAt}. Resubmit with confirmDuplicate to store it again.`
        : null,
    });
  }),
);

router.post(
  "/files/vendor-auto-detect",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const confirmDuplicate = req.body.confirmDuplicate === "true";
    if (!req.file) {
      res.status(400).json({ error: "FILE_REQUIRED", message: "No file was uploaded." });
      return;
    }
    const result = await uploadVendorFileAutoDetect(
      req.file.buffer,
      req.file.originalname,
      req.session.userId!,
      confirmDuplicate,
    );
    res.status(result.duplicateOf && !confirmDuplicate ? 200 : 201).json({
      file: result.file,
      detectedVendorLabel: result.detectedVendorLabel,
      duplicateWarning: result.duplicateOf
        ? `An identical file was already uploaded on ${result.duplicateOf.uploadedAt}. Resubmit with confirmDuplicate to store it again.`
        : null,
    });
  }),
);

router.get(
  "/miva/api-status",
  asyncHandler(async (_req, res) => {
    res.json({
      configured: isMivaApiConfigured(),
      environment: (process.env.MIVA_ENVIRONMENT ?? "development").toLowerCase(),
    });
  }),
);

router.post(
  "/miva/pull-snapshot",
  asyncHandler(async (req, res) => {
    const result = await pullMivaSnapshotFromApi(req.session.userId!);
    res.status(result.duplicateOf ? 200 : 201).json({
      file: result.file,
      duplicateWarning: result.duplicateOf
        ? `An identical Miva snapshot was already stored on ${result.duplicateOf.uploadedAt}.`
        : null,
    });
  }),
);

router.get(
  "/files/:id/catalog-rows",
  asyncHandler(async (req, res) => {
    const file = await getRepository().findFileById(req.params.id!);
    if (!file) throw new NotFoundError("File not found.");
    if (file.kind !== "miva_snapshot" && file.kind !== "post_import_snapshot") {
      throw new ValidationError("UNSUPPORTED_KIND", "Only Miva snapshot files can be browsed as a catalog.");
    }
    const { rows } = parseMivaSnapshotCsv(readStoredFileText(file.storagePath));
    res.json(rows);
  }),
);

router.get(
  "/files/:id/download",
  asyncHandler(async (req, res) => {
    const file = await getRepository().findFileById(req.params.id!);
    if (!file) throw new NotFoundError("File not found.");
    const buffer = readStoredFile(file.storagePath);
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(file.originalFilename)}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(buffer);
  }),
);

// ---------- Runs ----------

router.get(
  "/runs",
  asyncHandler(async (_req, res) => {
    res.json(await getRepository().listRuns());
  }),
);

export interface ParsedRunDate {
  year: number;
  month: number;
  day: number;
}

/**
 * An explicit runDate is an unambiguous calendar date (YYYY-MM-DD) chosen by
 * the caller -- its Y/M/D digits are parsed directly rather than round-tripped
 * through a UTC Date and reprojected to America/New_York, which shifted the
 * effective date back by a day (NY is UTC-4/-5, so UTC midnight lands on the
 * previous NY calendar day). Only the no-argument ("today") default needs an
 * actual timezone conversion, since "today" depends on the current instant.
 */
export function resolveRunDate(runDate: string | undefined, now: Date = new Date()): ParsedRunDate {
  if (runDate) {
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(runDate);
    if (!isoMatch) {
      throw new ValidationError("INVALID_REQUEST", "runDate must be in YYYY-MM-DD format.");
    }
    return { year: Number(isoMatch[1]), month: Number(isoMatch[2]), day: Number(isoMatch[3]) };
  }
  const nyParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(nyParts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

router.post(
  "/runs",
  asyncHandler(async (req, res) => {
    const { vendorFileId, mivaFileId, runDate } = req.body as {
      vendorFileId?: string;
      mivaFileId?: string;
      runDate?: string; // YYYY-MM-DD, defaults to today in America/New_York
    };
    if (!vendorFileId || !mivaFileId) {
      res.status(400).json({ error: "INVALID_REQUEST", message: "vendorFileId and mivaFileId are required." });
      return;
    }
    const parsedRunDate = resolveRunDate(runDate);

    const run = await createRun({ vendorFileId, mivaFileId, runDate: parsedRunDate, createdBy: req.session.userId! });
    res.status(201).json(run);
  }),
);

router.get(
  "/runs/:id",
  asyncHandler(async (req, res) => {
    const run = await getRepository().findRunById(req.params.id!);
    if (!run) throw new NotFoundError("Run not found.");
    const summary = run.status === "ready" ? await getRunSummary(run.id) : null;
    res.json({ run, summary });
  }),
);

router.get(
  "/runs/:id/rows",
  asyncHandler(async (req, res) => {
    const filter: RowFilter = {};
    if (req.query.reviewClass) filter.reviewClass = String(req.query.reviewClass).split(",");
    if (req.query.decisionStatus) filter.decisionStatus = String(req.query.decisionStatus).split(",");
    if (req.query.matchOutcome) filter.matchOutcome = String(req.query.matchOutcome).split(",");
    if (req.query.changed !== undefined) filter.changed = req.query.changed === "true";
    if (req.query.search) filter.search = String(req.query.search);
    const rows = await getRepository().listRunRows(req.params.id!, filter);
    res.json(rows);
  }),
);

router.post(
  "/runs/:id/decisions/approve-all-clean",
  asyncHandler(async (req, res) => {
    const count = await approveAllClean(req.params.id!, req.session.userId!);
    res.json({ approved: count });
  }),
);

router.post(
  "/runs/:id/decisions/bulk",
  asyncHandler(async (req, res) => {
    const { rowIds, decision } = req.body as { rowIds: string[]; decision: "APPROVED" | "REJECTED" };
    const result = await bulkDecision(req.params.id!, rowIds, decision, req.session.userId!);
    res.json(result);
  }),
);

router.post(
  "/runs/:id/decisions/:rowId",
  asyncHandler(async (req, res) => {
    const { decision } = req.body as { decision: "APPROVED" | "APPROVED_WARNING_ACK" | "REJECTED" | "PENDING" };
    await setRowDecision(req.params.id!, req.params.rowId!, decision, req.session.userId!);
    res.json({ ok: true });
  }),
);

router.get(
  "/runs/:id/batchable-count",
  asyncHandler(async (req, res) => {
    const rows = await getBatchableRows(req.params.id!);
    res.json({ count: rows.length });
  }),
);

router.post(
  "/runs/:id/batches",
  asyncHandler(async (req, res) => {
    const batch = await generateBatch(req.params.id!, req.session.userId!);
    res.status(201).json(batch);
  }),
);

router.get(
  "/runs/:id/batches",
  asyncHandler(async (req, res) => {
    res.json(await getRepository().listBatchesForRun(req.params.id!));
  }),
);

router.post(
  "/runs/:id/legacy-comparison",
  asyncHandler(async (req, res) => {
    const { legacyFileId } = req.body as { legacyFileId: string };
    const comparisonId = await runLegacyComparison(req.params.id!, legacyFileId, req.session.userId!);
    const rows = await getRepository().getLegacyComparisonRows(comparisonId);
    res.status(201).json({ comparisonId, rows });
  }),
);

router.get(
  "/runs/:id/legacy-comparisons",
  asyncHandler(async (req, res) => {
    res.json(await getRepository().listLegacyComparisonsForRun(req.params.id!));
  }),
);

// ---------- Batches ----------

router.get(
  "/batches",
  asyncHandler(async (_req, res) => {
    res.json(await getRepository().listAllBatches());
  }),
);

router.get(
  "/batches/:id",
  asyncHandler(async (req, res) => {
    const batch = await getRepository().findBatchById(req.params.id!);
    if (!batch) throw new NotFoundError("Batch not found.");
    res.json(batch);
  }),
);

router.post(
  "/batches/:id/push-to-miva",
  asyncHandler(async (req, res) => {
    const { confirmProduction } = req.body as { confirmProduction?: boolean };
    const result = await pushBatchToMiva(req.params.id!, req.session.userId!, confirmProduction === true);
    res.status(201).json(result);
  }),
);

router.post(
  "/batches/:id/import-outcome",
  asyncHandler(async (req, res) => {
    const { status } = req.body as { status: string };
    await getRepository().updateBatchImportStatus(req.params.id!, status);
    await getRepository().insertAuditLog({
      actorId: req.session.userId!,
      action: "BATCH_IMPORT_OUTCOME_RECORDED",
      entityType: "batch",
      entityId: req.params.id!,
      details: { status },
    });
    res.json({ ok: true });
  }),
);

router.post(
  "/batches/:id/post-import-verification",
  asyncHandler(async (req, res) => {
    const { postImportFileId } = req.body as { postImportFileId: string };
    const verificationId = await runPostImportVerification(req.params.id!, postImportFileId, req.session.userId!);
    const rows = await getRepository().getPostImportVerificationRows(verificationId);
    res.status(201).json({ verificationId, rows });
  }),
);

router.get(
  "/batches/:id/post-import-verifications",
  asyncHandler(async (req, res) => {
    res.json(await getRepository().listPostImportVerificationsForBatch(req.params.id!));
  }),
);

// ---------- Error handling ----------

export function errorHandler(
  err: unknown,
  _req: import("express").Request,
  res: import("express").Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: import("express").NextFunction,
): void {
  if (err instanceof ValidationError) {
    res.status(422).json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: "NOT_FOUND", message: err.message });
    return;
  }
  if (err instanceof ForbiddenError) {
    res.status(403).json({ error: "FORBIDDEN", message: err.message });
    return;
  }
  // Never log full raw rows or credentials; log only the error shape.
  // eslint-disable-next-line no-console
  console.error("Unhandled error:", err instanceof Error ? err.stack : err);
  res.status(500).json({ error: "INTERNAL_ERROR", message: "An unexpected error occurred." });
}
