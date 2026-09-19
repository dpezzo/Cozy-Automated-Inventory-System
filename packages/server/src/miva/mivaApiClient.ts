import { createHmac } from "node:crypto";

/** Thrown for any Miva JSON API transport or application-level failure. Never carries the signing key or token. */
export class MivaApiError extends Error {
  constructor(
    message: string,
    public readonly errorCode?: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "MivaApiError";
  }
}

interface MivaApiConfig {
  storeUrl: string;
  storeCode: string;
  apiToken: string;
  signingKey: string;
  basicAuthUser?: string;
  basicAuthPassword?: string;
}

function loadConfig(): MivaApiConfig {
  const storeUrl = process.env.MIVA_STORE_URL;
  const storeCode = process.env.MIVA_STORE_CODE;
  const apiToken = process.env.MIVA_API_TOKEN;
  const signingKey = process.env.MIVA_API_SIGNING_KEY;
  if (!storeUrl || !storeCode || !apiToken || !signingKey) {
    throw new MivaApiError(
      "Miva API is not configured. Set MIVA_STORE_URL, MIVA_STORE_CODE, MIVA_API_TOKEN, and MIVA_API_SIGNING_KEY.",
    );
  }
  return {
    storeUrl: storeUrl.replace(/\/+$/, ""),
    storeCode,
    apiToken,
    signingKey,
    basicAuthUser: process.env.MIVA_HTTP_BASIC_USER,
    basicAuthPassword: process.env.MIVA_HTTP_BASIC_PASSWORD,
  };
}

/** Base64(HMAC-SHA256(base64-decoded signing key, raw JSON body)), per docs.miva.com JSON API auth guide. */
export function signRequestBody(rawBody: string, signingKeyBase64: string): string {
  const key = Buffer.from(signingKeyBase64, "base64");
  return createHmac("sha256", key).update(rawBody, "utf8").digest("base64");
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Redacts anything that could leak a credential from a logged request/response summary. */
function redactForLogging(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const clone: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const key of Object.keys(clone)) {
    if (/token|signature|key|password|authorization/i.test(key)) clone[key] = "[REDACTED]";
  }
  return clone;
}

export interface MivaApiCallOptions {
  /** Overrides the default request timeout via the X-Miva-API-Timeout header (seconds). */
  timeoutSeconds?: number;
}

/**
 * Sends one JSON API request (a single Function call, an Iterations batch, or an
 * Operations multicall body) to the configured Miva store and returns the parsed
 * response. Retries transient failures with exponential backoff; never retries an
 * application-level Miva error (success: 0), since that reflects real request content.
 */
export async function callMivaApi(
  body: Record<string, unknown>,
  options: MivaApiCallOptions = {},
): Promise<Record<string, unknown>> {
  const config = loadConfig();
  const fullBody = {
    Store_Code: config.storeCode,
    Miva_Request_Timestamp: String(Math.floor(Date.now() / 1000)),
    ...body,
  };
  const rawBody = JSON.stringify(fullBody);
  const signature = signRequestBody(rawBody, config.signingKey);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Miva-API-Authorization": `MIVA-HMAC-SHA256 ${config.apiToken}:${signature}`,
  };
  if (options.timeoutSeconds) headers["X-Miva-API-Timeout"] = String(options.timeoutSeconds);
  if (config.basicAuthUser && config.basicAuthPassword) {
    const basic = Buffer.from(`${config.basicAuthUser}:${config.basicAuthPassword}`).toString("base64");
    headers["Authorization"] = `Basic ${basic}`;
  }

  // MIVA_STORE_URL may be either the bare store domain (https://store.example.com) or
  // the full JSON API endpoint already ending in json.mvc (e.g. a store whose JSON API
  // is mounted at a non-default path, like https://dev.example.com/shopping/json.mvc).
  const url = /json\.mvc$/i.test(config.storeUrl) ? config.storeUrl : `${config.storeUrl}/mm5/json.mvc`;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { method: "POST", headers, body: rawBody });
      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }
      const text = await response.text();
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new MivaApiError(
          `Miva API returned a non-JSON response (HTTP ${response.status}).`,
          undefined,
          response.status,
        );
      }
      if (parsed.success === 0) {
        throw new MivaApiError(
          typeof parsed.error_message === "string" ? parsed.error_message : "Miva API call failed.",
          typeof parsed.error_code === "string" ? parsed.error_code : undefined,
          response.status,
        );
      }
      return parsed;
    } catch (err) {
      lastError = err;
      if (err instanceof MivaApiError) throw err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }
    }
  }
  // eslint-disable-next-line no-console
  console.error("Miva API request failed after retries:", redactForLogging(fullBody), lastError);
  throw new MivaApiError(
    lastError instanceof Error ? lastError.message : "Miva API request failed after retries.",
  );
}

/**
 * The store's own mount path (e.g. "/shopping" when MIVA_STORE_URL is
 * ".../shopping/json.mvc"), needed because product asset URLs (images) live
 * under this same mount on the storefront domain -- confirmed against the
 * development store: an active product's image only resolved at
 * "<storefront-origin>/shopping/graphics/...", not at the origin root, even
 * though the "link" custom field points to prettier "/shop/..." page URLs
 * that don't reflect this mount segment.
 */
export function getMivaMountPath(): string {
  const storeUrl = process.env.MIVA_STORE_URL ?? "";
  try {
    return new URL(storeUrl).pathname.replace(/\/json\.mvc$/i, "").replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** True when the required Miva API env vars are present, used to gate UI/route availability. */
export function isMivaApiConfigured(): boolean {
  return Boolean(
    process.env.MIVA_STORE_URL &&
      process.env.MIVA_STORE_CODE &&
      process.env.MIVA_API_TOKEN &&
      process.env.MIVA_API_SIGNING_KEY,
  );
}
