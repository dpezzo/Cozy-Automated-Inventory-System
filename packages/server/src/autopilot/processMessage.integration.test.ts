import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteRepository } from "../db/sqliteRepository";

// vite can't resolve the node:sqlite builtin by itself, so hand it the real module through Node's own loader.
vi.mock("node:sqlite", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(__filename)("node:sqlite");
});
// Real SQLite (migrations included) and real file storage in a temp dir, so upload, run creation and the brake run for real.
let repo: SqliteRepository;
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getRepository: () => repo,
}));

import { processInboundMessage, type ProcessDeps } from "./processMessage";
import { uploadFile } from "../domain/uploadService";
import { setAutopilotMode, setVendorAutopilot } from "./settings";
import type { InboundMessage } from "./inbox";
import type { AutopilotReportData } from "./report";

const FIXTURES = path.resolve(__dirname, "../../test-fixtures/synthetic");
const OLLIIX_FILE = readFileSync(path.join(FIXTURES, "Olliix_synthetic_inventory.xlsx"));
const MIVA_CSV = path.join(FIXTURES, "Miva_synthetic_pre_import.csv");
const DISCONTINUED_FILE = path.resolve(__dirname, "../../../../../Vendors/Discontinue_Items_Notification_Email_202610231500007732.xlsx");
const GOOD_AUTH = "mx.google.com; dkim=pass; spf=pass; dmarc=pass (p=NONE)";

let tmp: string;
let adminId: string;
let reports: AutopilotReportData[];
let pulls: number;

const deps: ProcessDeps = {
  pullSnapshot: async (userId) => {
    pulls++;
    return uploadFile(readFileSync(MIVA_CSV), "miva-pull.csv", "miva_snapshot", userId, true);
  },
  report: async (data) => {
    reports.push(data);
  },
  getMivaSite: async () => "development",
};

let counter = 0;
function email(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    messageId: `<msg-${++counter}@test>`,
    from: "cale@delutti.com",
    subject: "Olliix inventory",
    date: new Date(),
    authResults: GOOD_AUTH,
    attachments: [{ filename: "Olliix_daily_inventory.xlsx", content: OLLIIX_FILE }],
    ...overrides,
  };
}

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "autopilot-"));
  process.env.UPLOAD_DIR = path.join(tmp, "files");
  repo = new SqliteRepository(path.join(tmp, "test.db"));
  await repo.init();
  adminId = (await repo.createUser({ email: "admin@example.com", role: "admin", passwordHash: "x" })).id;
  await setAutopilotMode("review");
  await setVendorAutopilot("olliix", { enabled: true });
});
afterAll(async () => {
  await repo.close();
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});
beforeEach(() => {
  reports = [];
  pulls = 0;
});

describe("processInboundMessage (Stage 1, review only)", () => {
  it("ignores an unapproved sender silently: no reply, no upload, no Miva pull", async () => {
    const outcome = await processInboundMessage(email({ from: "stranger@example.com" }), deps);
    expect(outcome).toBe("IGNORED");
    expect(reports).toEqual([]);
    expect(pulls).toBe(0);
    expect(await repo.listFiles("olliix_workbook")).toHaveLength(0);
  });

  it("ignores an approved address that fails the DMARC check (forged sender)", async () => {
    const outcome = await processInboundMessage(email({ authResults: "mx.google.com; dmarc=fail" }), deps);
    expect(outcome).toBe("IGNORED");
    expect(reports).toEqual([]);
    expect(pulls).toBe(0);
  });

  it("rejects an email with no spreadsheet attachment and says so", async () => {
    const outcome = await processInboundMessage(email({ attachments: [{ filename: "note.pdf", content: Buffer.from("x") }] }), deps);
    expect(outcome).toBe("REJECTED");
    expect(reports[0]?.notes[0]).toContain("no .xlsx or .csv");
  });

  it("rejects a spreadsheet no vendor recognizes", async () => {
    const outcome = await processInboundMessage(email({ attachments: [{ filename: "random.csv", content: Buffer.from("a,b\n1,2\n") }] }), deps);
    expect(outcome).toBe("REJECTED");
    expect(pulls).toBe(0);
  });

  it("reviews a good Olliix file: creates a run, records the brake numbers, sends a report, pushes nothing", async () => {
    const outcome = await processInboundMessage(email(), deps);
    expect(["REVIEWED", "HELD"]).toContain(outcome);
    expect(pulls).toBe(1);

    const [message] = await repo.listAutopilotMessages(1);
    expect(message!.runId).toBeTruthy();
    expect(message!.vendorKey).toBe("olliix");
    expect(message!.details).toHaveProperty("brake");
    const run = await repo.findRunById(message!.runId!);
    expect(run?.status).toBe("ready");

    // The run belongs to the login-less service user, never a person.
    const serviceUser = await repo.findUserByEmail("autopilot@service.invalid");
    expect(serviceUser).toMatchObject({ isActive: false, passwordHash: null, googleId: null });
    expect(reports).toHaveLength(1);
    expect(reports[0]!.runId).toBe(run!.id);
    expect(reports[0]!.notes.join(" ")).toContain("A later stage");
    expect(await repo.listBatchesForRun(run!.id)).toHaveLength(0);
  });

  it("handles the same email only once", async () => {
    const msg = email();
    await processInboundMessage(msg, deps);
    const pullsAfterFirst = pulls;
    expect(await processInboundMessage(msg, deps)).toBe("SKIPPED");
    expect(pulls).toBe(pullsAfterFirst);
  });

  it("recognizes an identical file that already has a run as a duplicate and does nothing new", async () => {
    // The previous test already ran this exact file.
    const outcome = await processInboundMessage(email(), deps);
    expect(outcome).toBe("DUPLICATE");
    expect(pulls).toBe(0);
    expect(reports[0]!.outcome).toBe("DUPLICATE");
  });

  it("rejects a vendor that is not switched on, even from an approved sender", async () => {
    await setVendorAutopilot("olliix", { enabled: false });
    const outcome = await processInboundMessage(email({ attachments: [{ filename: "o.xlsx", content: Buffer.concat([OLLIIX_FILE]) }] }), deps);
    // The sender is no longer approved for any enabled vendor, so it is ignored before anything else happens.
    expect(outcome).toBe("IGNORED");
    await setVendorAutopilot("olliix", { enabled: true });
  });

  it("only accepts a sender who is on that vendor's own approved list", async () => {
    await setVendorAutopilot("olliix", { approvedSenders: "cale@delutti.com" });
    await setVendorAutopilot("gobi", { enabled: true, approvedSenders: "other@delutti.com" });
    const outcome = await processInboundMessage(
      email({ from: "other@delutti.com", attachments: [{ filename: "Olliix_daily_inventory.xlsx", content: OLLIIX_FILE }] }),
      deps,
    );
    expect(outcome).toBe("REJECTED");
    expect(reports[0]!.notes[0]).toContain("not an approved sender");
  });

  it("merges a discontinued-items list sent on its own, without creating a run", async () => {
    await setVendorAutopilot("olliix", { approvedSenders: "cale@delutti.com" });
    const outcome = await processInboundMessage(
      email({ attachments: [{ filename: "Discontinue_Items.xlsx", content: readFileSync(DISCONTINUED_FILE) }] }),
      deps,
    );
    expect(outcome).toBe("REVIEWED");
    expect(pulls).toBe(0);
    expect(await repo.listDiscontinuedUpcs("olliix")).toHaveLength(36);
    expect(reports[0]!.runId).toBeNull();
  });
});

describe("autopilot_messages", () => {
  it("lists newest first and refuses a repeated Message-ID", async () => {
    const first = await repo.insertAutopilotMessage({ messageId: "<dup@test>", sender: "a@b.com", subject: "s", outcome: "IGNORED" });
    expect(first).not.toBeNull();
    expect(await repo.insertAutopilotMessage({ messageId: "<dup@test>", sender: "a@b.com", subject: "s", outcome: "IGNORED" })).toBeNull();
    expect((await repo.listAutopilotMessages(1))[0]!.messageId).toBe("<dup@test>");
    expect(adminId).toBeTruthy();
  });
});
