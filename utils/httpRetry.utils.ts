import { isAxiosError } from "axios";

export const RETRY_MAX = 5;
export const BASE_RETRY_DELAY_MS = 1000;

// Prevent individual HTTP requests from hanging indefinitely.
// With RETRY_MAX=5 the worst-case wall-time per call-site is:
//   (RETRY_MAX+1) × REQUEST_TIMEOUT_MS + Σ(1..RETRY_MAX)×BASE_RETRY_DELAY_MS
//   = 6 × 10 000 + 15 000 = 75 000 ms  (< Telegraf's 90 s handler timeout)
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * A fault the upstream is expected to recover from on its own, whatever status
 * line carried it. Statuses alone cannot express this: a 4xx normally means
 * "do not try again", yet some upstreams answer a throttled or half-broken
 * request with one. Raising this instead makes {@link shouldRetry} retry.
 */
export class TransientUpstreamError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TransientUpstreamError";
  }
}

/**
 * A 2xx response whose body is not the expected JSON payload: an HTML login
 * page, an overload notice, or a bare `null`. The status line carries no signal
 * in that case, so the body is the only tell, and the condition is usually
 * transient on the server side.
 */
export class NonJsonResponseError extends TransientUpstreamError {
  constructor(source: string) {
    super(`${source} answered 2xx with a non-JSON body`);
    this.name = "NonJsonResponseError";
  }
}

/**
 * Rejects a payload that is not a JSON array or object, so a login page or an
 * error page served with a 200 is retried instead of being read as "no data".
 */
export function assertJsonPayload<T>(
  data: T,
  source: string
): Exclude<T, null | undefined | string> {
  if (data === null || data === undefined || typeof data === "string") {
    throw new NonJsonResponseError(source);
  }
  return data as Exclude<T, null | undefined | string>;
}

export function shouldRetry(e: unknown): boolean {
  if (e instanceof TransientUpstreamError) return true;
  if (!isAxiosError(e)) return false;
  const s = e.response?.status;
  return !(s && s >= 400 && s < 500 && s !== 408 && s !== 429);
}

/** Linear backoff: 1 s, 2 s, 3 s, ... on successive attempts. */
export function retryDelayMs(retryNumber: number): number {
  return BASE_RETRY_DELAY_MS * (retryNumber + 1);
}

export function waitBeforeRetry(retryNumber: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, retryDelayMs(retryNumber))
  );
}
