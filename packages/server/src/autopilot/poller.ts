import { ImapInboxSource, imapConfigFromEnv, type InboxSource } from "./inbox";
import { processInboundMessage } from "./processMessage";
import { getAutopilotMode, getEnabledSince } from "./settings";
import { isFeatureEnabled } from "../domain/featureFlags";

const POLL_INTERVAL_MS = 2 * 60 * 1000;

export interface PollStatus {
  mailboxConfigured: boolean;
  lastPollAt: string | null;
  lastError: string | null;
  lastHandledCount: number;
}

const status: PollStatus = { mailboxConfigured: false, lastPollAt: null, lastError: null, lastHandledCount: 0 };
let running = false;

export function getPollStatus(): PollStatus {
  status.mailboxConfigured = imapConfigFromEnv() !== null;
  return { ...status };
}

/**
 * One pass over the mailbox. Single-flight (a slow pass is never overlapped by
 * the next tick) and a complete no-op unless the feature flag is on AND the mode
 * is not "off", read fresh each time so changing a setting needs no redeploy.
 */
export async function pollOnce(source: InboxSource | null = defaultSource()): Promise<number> {
  if (running || !source) return 0;
  running = true;
  try {
    if (!(await isFeatureEnabled("autopilot")) || (await getAutopilotMode()) === "off") return 0;
    const sinceIso = await getEnabledSince();
    const handled = await source.processUnread((m) => processInboundMessage(m).then(() => undefined), sinceIso ? new Date(sinceIso) : null);
    status.lastPollAt = new Date().toISOString();
    status.lastError = null;
    status.lastHandledCount = handled;
    return handled;
  } catch (err) {
    status.lastPollAt = new Date().toISOString();
    status.lastError = err instanceof Error ? err.message : String(err);
    console.error("Autopilot poll failed:", status.lastError);
    return 0;
  } finally {
    running = false;
  }
}

function defaultSource(): InboxSource | null {
  const config = imapConfigFromEnv();
  return config ? new ImapInboxSource(config) : null;
}

/** Starts the recurring poll. Safe to call when the mailbox is not configured: it just logs once and never polls. */
export function startAutopilotPoller(): { stop: () => void } | null {
  if (!imapConfigFromEnv()) {
    // eslint-disable-next-line no-console
    console.log("Autopilot mailbox not configured (AUTOPILOT_IMAP_USER / AUTOPILOT_IMAP_PASSWORD); the poller is not running.");
    return null;
  }
  const timer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  timer.unref();
  // eslint-disable-next-line no-console
  console.log("Autopilot poller started (checks every 2 minutes; does nothing until switched on in Settings > Autopilot).");
  return { stop: () => clearInterval(timer) };
}
