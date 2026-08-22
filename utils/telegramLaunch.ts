import type { HealthProbe } from "./healthServer.ts";

/** HTTP status Telegram answers with when two clients long-poll one token. */
const CONFLICT_STATUS = 409;

/**
 * Waits between launch attempts, ~60s in total. A container replacement holds
 * the token only while the outgoing instance drains its 50s long poll.
 */
export const DEFAULT_CONFLICT_DELAYS_MS = [5_000, 10_000, 15_000, 30_000];

const sleepFor = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True for the error telegraf surfaces when another process is polling the
 * same bot token: "409: Conflict: terminated by other getUpdates request".
 */
export const isTelegramConflict = (error: unknown): boolean =>
  error instanceof Error &&
  (error as { code?: unknown }).code === CONFLICT_STATUS;

export interface LaunchWithConflictRetryOptions {
  /** Starts long polling; settles when polling ends or fails. */
  launch: () => Promise<void>;
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  onConflict?: (attempt: number, delayMs: number, error: unknown) => void;
}

/**
 * Launches the bot, retrying while another instance still holds the token.
 *
 * Telegram serves `getUpdates` to a single client, so a rolling redeploy that
 * overlaps the outgoing container makes the incoming one fail with 409. The
 * conflict clears itself once the old instance exits, so retry rather than
 * die; any other failure, and a conflict outliving every delay, is raised to
 * the caller.
 *
 * Resolves when polling ends on purpose (shutdown stops the bot).
 */
export const launchWithConflictRetry = async ({
  launch,
  delaysMs = DEFAULT_CONFLICT_DELAYS_MS,
  sleep = sleepFor,
  onConflict
}: LaunchWithConflictRetryOptions): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      await launch();
      return;
    } catch (error) {
      if (!isTelegramConflict(error) || attempt > delaysMs.length) throw error;
      const delayMs = delaysMs[attempt - 1];
      onConflict?.(attempt, delayMs, error);
      await sleep(delayMs);
    }
  }
};

/**
 * Health probe backed by the bot's polling state.
 *
 * Reaching the Bot API says nothing about long polling: a process whose
 * `launch()` failed still answers `getMe` while receiving no update at all.
 * Reporting that process unhealthy lets the container be replaced instead of
 * lingering deaf.
 */
export const pollingProbe =
  (isPolling: () => boolean): HealthProbe =>
  () =>
    isPolling()
      ? { ok: true }
      : { ok: false, detail: "Telegram long polling stopped" };
