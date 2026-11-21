import { getRepository, type AutopilotOutcome, type FileRecord, type UserRecord } from "../db";
import { detectVendorFile } from "../vendor/vendorFileRegistry";
import { uploadVendorFileAutoDetect, type UploadResult } from "../domain/uploadService";
import { createRun } from "../domain/runService";
import { DISCONTINUED_LIST_VENDOR_KEY } from "../domain/discontinuedListService";
import { pullMivaSnapshotFromApi } from "../miva/mivaProducts";
import { ValidationError } from "../errors";
import { evaluateBrake, type BrakeResult } from "./brake";
import type { InboundMessage } from "./inbox";
import { sendAutopilotReport, type AutopilotReportData } from "./report";
import {
  getAllEnabledSenders,
  getBrakeLimits,
  getVendorApprovedSenders,
  isVendorAutopilotEnabled,
} from "./settings";
import { isSenderApproved, passesAuthentication } from "./senders";

const SERVICE_USER_EMAIL = "autopilot@service.invalid";
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".xlsx", ".csv"];

/** The side effects a message needs, injectable so tests never touch Miva or send email. */
export interface ProcessDeps {
  pullSnapshot: (userId: string) => Promise<UploadResult>;
  report: (data: AutopilotReportData) => Promise<void>;
  /** Which Miva store the snapshot is pulled from, for the report. */
  getMivaSite: () => Promise<string>;
}

export const defaultProcessDeps: ProcessDeps = {
  pullSnapshot: pullMivaSnapshotFromApi,
  report: sendAutopilotReport,
  getMivaSite: () => getRepository().getMivaActiveSite(),
};

/**
 * The "Autopilot" user that owns everything the mailbox creates, so the activity
 * log shows who acted. It has no password and no Google id, so nobody can sign in
 * as it, and it is marked inactive as a second lock.
 */
export async function ensureAutopilotUser(): Promise<UserRecord> {
  const repo = getRepository();
  const existing = await repo.findUserByEmail(SERVICE_USER_EMAIL);
  if (existing) return existing;
  const created = await repo.createUser({ email: SERVICE_USER_EMAIL, passwordHash: null, role: "member", displayName: "Autopilot" });
  return repo.updateUser(created.id, { isActive: false });
}

function todayInNewYork(now: Date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function hasAcceptedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

async function previousRowCountFor(file: FileRecord): Promise<number | null> {
  const files = await getRepository().listFiles(file.kind);
  const earlier = files
    .filter((f) => f.id !== file.id && f.vendorKey === file.vendorKey && f.rowCount !== null && f.uploadedAt < file.uploadedAt)
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
  return earlier[0]?.rowCount ?? null;
}

const UNMATCHED = "UNMATCHED - BRAND ELIGIBILITY UNKNOWN";
const NLA_STATUS = "NO LONGER AVAILABLE";

async function brakeForRun(runId: string, file: FileRecord): Promise<BrakeResult> {
  const rows = await getRepository().listRunRows(runId);
  let carried = 0;
  let changedCarried = 0;
  let nla = 0;
  let missingOrBlocked = 0;
  for (const { row } of rows) {
    if (row.matchOutcome === UNMATCHED) continue;
    carried++;
    if (row.changed) changedCarried++;
    if (row.changed && row.proposed.simpleInventory === NLA_STATUS && row.current.simpleInventory !== NLA_STATUS) nla++;
    if (row.matchOutcome === "MISSING - REVIEW REQUIRED" || row.reviewClass === "BLOCKED") missingOrBlocked++;
  }
  return evaluateBrake(
    {
      fileRowCount: file.rowCount ?? 0,
      previousRowCount: await previousRowCountFor(file),
      carriedCount: carried,
      changedCarriedCount: changedCarried,
      nlaProposalCount: nla,
      missingOrBlockedCount: missingOrBlocked,
    },
    await getBrakeLimits(),
  );
}

interface FinalOutcome {
  outcome: AutopilotOutcome;
  vendorKey: string | null;
  fileId: string | null;
  runId: string | null;
  details: Record<string, unknown>;
  report: AutopilotReportData | null;
}

/**
 * Handles one inbound email end to end (Stage 1: review only). Every path ends
 * with exactly one autopilot_messages row, which is also what makes a message
 * safe to see twice. Nothing here ever pushes to Miva.
 */
export async function processInboundMessage(message: InboundMessage, deps: ProcessDeps = defaultProcessDeps): Promise<AutopilotOutcome | "SKIPPED"> {
  const repo = getRepository();
  if (await repo.hasAutopilotMessage(message.messageId)) return "SKIPPED";

  let final: FinalOutcome;
  try {
    final = await decide(message, deps);
  } catch (err) {
    const text = err instanceof Error ? err.message : "Unknown error.";
    console.error("Autopilot failed on a message:", text);
    final = {
      outcome: "FAILED",
      vendorKey: null,
      fileId: null,
      runId: null,
      details: { error: text },
      report: {
        outcome: "FAILED",
        vendorLabel: null,
        sender: message.from,
        subject: message.subject,
        fileNames: message.attachments.map((a) => a.filename),
        runId: null,
        notes: [`Autopilot hit an error and did nothing further: ${text}`],
        brake: null,
        mivaSite: null,
      },
    };
  }

  const stored = await repo.insertAutopilotMessage({
    messageId: message.messageId,
    sender: message.from,
    subject: message.subject,
    outcome: final.outcome,
    vendorKey: final.vendorKey,
    fileId: final.fileId,
    runId: final.runId,
    details: final.details,
  });
  if (stored === null) return "SKIPPED"; // lost a race with another poll
  await repo.insertAuditLog({
    actorId: null,
    action: "AUTOPILOT_MESSAGE",
    entityType: "system",
    entityId: null,
    details: { outcome: final.outcome, sender: message.from, subject: message.subject, vendorKey: final.vendorKey, runId: final.runId },
  });
  if (final.report) await deps.report(final.report);
  return final.outcome;
}

function rejected(message: InboundMessage, notes: string[], details: Record<string, unknown> = {}, vendorLabel: string | null = null, vendorKey: string | null = null): FinalOutcome {
  return {
    outcome: "REJECTED",
    vendorKey,
    fileId: null,
    runId: null,
    details: { ...details, reason: notes[0] },
    report: {
      outcome: "REJECTED",
      vendorLabel,
      sender: message.from,
      subject: message.subject,
      fileNames: message.attachments.map((a) => a.filename),
      runId: null,
      notes,
      brake: null,
      mivaSite: null,
    },
  };
}

async function decide(message: InboundMessage, deps: ProcessDeps): Promise<FinalOutcome> {
  const repo = getRepository();

  // Gate 1: stay silent for anyone not approved anywhere, so strangers learn nothing and get no reply.
  if (!isSenderApproved(message.from, await getAllEnabledSenders())) {
    return { outcome: "IGNORED", vendorKey: null, fileId: null, runId: null, details: { reason: "Sender is not approved for any autopilot vendor." }, report: null };
  }
  // Gate 2: the From address must not be forged.
  if (!passesAuthentication(message.authResults)) {
    return { outcome: "IGNORED", vendorKey: null, fileId: null, runId: null, details: { reason: "The message did not pass the DMARC check." }, report: null };
  }

  const usable = message.attachments.filter((a) => hasAcceptedExtension(a.filename) && a.content.length > 0 && a.content.length <= MAX_ATTACHMENT_BYTES);
  if (usable.length === 0) {
    return rejected(message, ["The email had no .xlsx or .csv attachment (under 25 MB) to read."]);
  }

  const user = await ensureAutopilotUser();

  // Step 1: identify and authorize every attachment BEFORE storing any of them.
  interface Planned {
    filename: string;
    content: Buffer;
    vendorKey: string | null; // null = not a recognizable inventory file; may be the discontinued-items list
  }
  const planned: Planned[] = [];
  for (const attachment of usable) {
    let vendorKey: string | null = null;
    try {
      vendorKey = (await detectVendorFile(attachment.content)).vendorKey;
    } catch {
      vendorKey = null;
    }
    const authorizedKey = vendorKey ?? DISCONTINUED_LIST_VENDOR_KEY;
    if (!(await isVendorAutopilotEnabled(authorizedKey))) {
      return rejected(message, [`Autopilot is not turned on for "${authorizedKey}" (file: ${attachment.filename}).`], { filename: attachment.filename }, null, authorizedKey);
    }
    if (!isSenderApproved(message.from, await getVendorApprovedSenders(authorizedKey))) {
      return rejected(message, [`${message.from} is not an approved sender for "${authorizedKey}" (file: ${attachment.filename}).`], { filename: attachment.filename }, null, authorizedKey);
    }
    planned.push({ filename: attachment.filename, content: attachment.content, vendorKey });
  }

  // Step 2: store everything. The discontinued-items list is merged into its cumulative list on upload, so it is
  // in place before any run below is created (a run reads that list).
  const uploads: { planned: Planned; result: Awaited<ReturnType<typeof uploadVendorFileAutoDetect>> }[] = [];
  for (const p of planned) {
    try {
      uploads.push({ planned: p, result: await uploadVendorFileAutoDetect(p.content, p.filename, user.id, false) });
    } catch (err) {
      if (err instanceof ValidationError) {
        return rejected(message, [`${p.filename} could not be used: ${err.message}`], { filename: p.filename, code: err.code });
      }
      throw err;
    }
  }

  const notes: string[] = [];
  const discontinued = uploads.filter((u) => u.result.discontinuedImport !== undefined || u.planned.vendorKey === null);
  for (const u of discontinued) {
    const imp = u.result.discontinuedImport;
    notes.push(
      imp
        ? `Merged the discontinued-items list ${u.planned.filename} into Olliix's cumulative list.`
        : `${u.planned.filename} is a discontinued-items list that was already merged earlier.`,
    );
  }

  const inventory = uploads.filter((u) => u.planned.vendorKey !== null && u.result.discontinuedImport === undefined);
  if (inventory.length === 0) {
    // Only a discontinued list arrived: nothing to reconcile.
    const first = discontinued[0]!;
    return {
      outcome: "REVIEWED",
      vendorKey: DISCONTINUED_LIST_VENDOR_KEY,
      fileId: first.result.file.id,
      runId: null,
      details: { discontinuedOnly: true },
      report: {
        outcome: "REVIEWED",
        vendorLabel: first.result.detectedVendorLabel,
        sender: message.from,
        subject: message.subject,
        fileNames: usable.map((a) => a.filename),
        runId: null,
        notes: [...notes, "No inventory file came with it, so no run was created. The list applies to the next regular inventory file."],
        brake: null,
        mivaSite: null,
      },
    };
  }

  // Step 3: one run per inventory file, compared against a fresh Miva snapshot.
  const target = inventory[0]!;
  const existingRuns = await repo.listRuns();
  const earlierRun = target.result.duplicateOf ? existingRuns.find((r) => r.vendorFileId === target.result.file.id && r.status !== "failed") : undefined;
  if (earlierRun) {
    return {
      outcome: "DUPLICATE",
      vendorKey: target.planned.vendorKey,
      fileId: target.result.file.id,
      runId: earlierRun.id,
      details: { existingRunId: earlierRun.id },
      report: {
        outcome: "DUPLICATE",
        vendorLabel: target.result.detectedVendorLabel,
        sender: message.from,
        subject: message.subject,
        fileNames: usable.map((a) => a.filename),
        runId: earlierRun.id,
        notes: [...notes, `${target.planned.filename} is identical to a file that already has a run, so nothing new was done.`],
        brake: null,
        mivaSite: null,
      },
    };
  }

  const snapshot = await deps.pullSnapshot(user.id);
  const mivaSite = await deps.getMivaSite();
  const run = await createRun({ vendorFileId: target.result.file.id, mivaFileId: snapshot.file.id, runDate: todayInNewYork(), createdBy: user.id });
  const brake = await brakeForRun(run.id, target.result.file);

  const parserVersion = target.result.parserVersion ?? null;
  const parserFellBackFrom = target.result.parserFellBackFrom ?? null;
  if (parserVersion) {
    notes.push(
      parserFellBackFrom
        ? `The file was read with parser ${parserVersion}. The active parser (${parserFellBackFrom}) did not fit it, so another version was used automatically. Check Manage Vendors if the vendor changed its file layout.`
        : `The file was read with parser ${parserVersion}.`,
    );
  }
  const extra = inventory.length - 1;
  if (extra > 0) notes.push(`${extra} more inventory file${extra === 1 ? "" : "s"} came in the same email and were stored but not run; send them one per email.`);
  notes.push(
    brake.hold
      ? "A run was created for review. A later stage of autopilot would have waited for a person on this one."
      : "A run was created for review. A later stage of autopilot would have pushed this on its own.",
  );
  const outcome: AutopilotOutcome = brake.hold ? "HELD" : "REVIEWED";
  return {
    outcome,
    vendorKey: target.planned.vendorKey,
    fileId: target.result.file.id,
    runId: run.id,
    details: {
      brake,
      mivaSite,
      snapshotFileId: snapshot.file.id,
      attachments: usable.map((a) => a.filename),
      ...(parserVersion ? { parserVersion, parserFellBackFrom } : {}),
    },
    report: {
      outcome,
      vendorLabel: target.result.detectedVendorLabel,
      sender: message.from,
      subject: message.subject,
      fileNames: usable.map((a) => a.filename),
      runId: run.id,
      notes,
      brake,
      mivaSite,
    },
  };
}
