import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createHash } from "node:crypto";

export interface InboundAttachment {
  filename: string;
  content: Buffer;
}

/** What the autopilot needs from one email, independent of how it was fetched. */
export interface InboundMessage {
  /** The email's Message-ID header (a stable fallback is made up if it has none). */
  messageId: string;
  /** Lower-cased From address. */
  from: string | null;
  subject: string | null;
  date: Date | null;
  /** The Authentication-Results header added by our own mail server, if any. */
  authResults: string | null;
  attachments: InboundAttachment[];
}

/**
 * Where inbound messages come from. The IMAP implementation below is the real
 * one; tests use a fake, and a Gmail API implementation could replace it later
 * without touching anything that handles a message.
 */
export interface InboxSource {
  /**
   * Hands each unread message (received at or after `since`, when given) to the
   * handler, and marks it read only once the handler returns. A handler that
   * throws leaves the message unread; the handler is expected to be idempotent
   * (the autopilot dedupes on Message-ID), so a retry is harmless.
   */
  processUnread(handler: (message: InboundMessage) => Promise<void>, since: Date | null): Promise<number>;
}

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

/** Null when the mailbox is not configured, so the server starts fine without the autopilot variables. */
export function imapConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ImapConfig | null {
  const user = env.AUTOPILOT_IMAP_USER;
  const password = env.AUTOPILOT_IMAP_PASSWORD;
  if (!user || !password) return null;
  return { host: env.AUTOPILOT_IMAP_HOST || "imap.gmail.com", port: Number(env.AUTOPILOT_IMAP_PORT) || 993, user, password };
}

const MAX_MESSAGE_BYTES = 30 * 1024 * 1024;

function fallbackMessageId(from: string | null, subject: string | null, date: Date | null, size: number): string {
  const hash = createHash("sha256").update(`${from}|${subject}|${date?.toISOString()}|${size}`).digest("hex").slice(0, 32);
  return `<generated-${hash}@autopilot.local>`;
}

export class ImapInboxSource implements InboxSource {
  constructor(private readonly config: ImapConfig) {}

  async processUnread(handler: (message: InboundMessage) => Promise<void>, since: Date | null): Promise<number> {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: true,
      auth: { user: this.config.user, pass: this.config.password },
      logger: false,
    });
    // An unhandled 'error' event (e.g. a dropped socket) would otherwise crash the whole server.
    client.on("error", (err: unknown) => console.error("Autopilot IMAP connection error:", err instanceof Error ? err.message : err));

    let handled = 0;
    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const found = await client.search(since ? { seen: false, since } : { seen: false }, { uid: true });
        const uids = found || [];
        for (const uid of uids) {
          const meta = await client.fetchOne(String(uid), { size: true, internalDate: true }, { uid: true });
          if (!meta) continue;
          const received = meta.internalDate ? new Date(meta.internalDate) : null;
          // IMAP's SINCE only has whole-day precision; enforce the exact moment autopilot was switched on.
          const tooOld = since !== null && received !== null && received.getTime() < since.getTime();
          const tooBig = (meta.size ?? 0) > MAX_MESSAGE_BYTES;
          if (!tooOld && !tooBig) {
            const full = await client.fetchOne(String(uid), { source: true }, { uid: true });
            if (!full || !full.source) continue;
            const parsed = await simpleParser(full.source);
            const from = parsed.from?.value[0]?.address?.toLowerCase() ?? null;
            const subject = parsed.subject ?? null;
            const authLine = parsed.headerLines.find((h) => h.key === "authentication-results")?.line ?? null;
            await handler({
              messageId: parsed.messageId ?? fallbackMessageId(from, subject, parsed.date ?? received, meta.size ?? 0),
              from,
              subject,
              date: parsed.date ?? received,
              authResults: authLine,
              attachments: parsed.attachments.map((a) => ({ filename: a.filename ?? "attachment", content: a.content })),
            });
            handled++;
          }
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return handled;
  }
}
