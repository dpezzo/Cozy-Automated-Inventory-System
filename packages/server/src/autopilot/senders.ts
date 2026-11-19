/** Splits a comma/semicolon/newline separated list of email addresses into a clean, lower-cased, de-duplicated list. */
export function parseSenderList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\n]/)) {
    const email = part.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}

export function isSenderApproved(sender: string | null | undefined, approved: string[]): boolean {
  if (!sender) return false;
  return approved.includes(sender.trim().toLowerCase());
}

/**
 * True only when the receiving mail server (Google) recorded a passing DMARC
 * result, meaning the From address was not forged. A missing header counts as a
 * failure: an unverifiable message must never be trusted just because it names
 * an approved sender. Only the first (most recently added, i.e. our own
 * server's) Authentication-Results header is consulted, since earlier hops
 * could be written by the sender.
 */
export function passesAuthentication(authResults: string | string[] | null | undefined): boolean {
  const header = Array.isArray(authResults) ? authResults[0] : authResults;
  if (!header) return false;
  return /\bdmarc=pass\b/i.test(header);
}
