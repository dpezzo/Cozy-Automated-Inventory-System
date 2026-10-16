import { Resend } from "resend";

let client: Resend | null | undefined; // undefined = not yet checked, null = no key configured

/** Lazily constructs the Resend client from RESEND_API_KEY. Returns null (not a throw) when unset, so email reporting stays fully optional -- callers check for null rather than needing a try/catch for "unconfigured." */
export function getResendClient(): Resend | null {
  if (client !== undefined) return client;
  const apiKey = process.env.RESEND_API_KEY;
  client = apiKey ? new Resend(apiKey) : null;
  return client;
}
