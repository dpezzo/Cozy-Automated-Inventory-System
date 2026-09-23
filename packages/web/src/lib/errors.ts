import { ApiRequestError } from "../api";

/** Plain-language error text for display -- never the raw error code, just the backend's message (or a fallback when the failure isn't even an API error, e.g. a network drop). */
export function friendlyError(err: unknown, fallback: string): string {
  return err instanceof ApiRequestError ? err.body.message : fallback;
}
