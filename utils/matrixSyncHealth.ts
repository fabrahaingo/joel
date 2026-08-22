import { MessageApp } from "../types.ts";
import { logError, logWarning } from "./debugLogger.ts";
import { describeMatrixPayload } from "./matrixLogService.ts";

/** Consecutive failed syncs that make an outage worth reporting. */
export const SYNC_ALERT_AFTER_FAILURES = 5;

/** Or, for a slow sync loop, how long the failures may last before reporting. */
export const SYNC_ALERT_AFTER_MS = 2 * 60 * 1000;

/** Delay before a still-failing sync is reported again. */
export const SYNC_REALERT_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * How long syncs must keep succeeding before the outage is called over.
 * A flaky homeserver answers one sync then fails the next, so a single success
 * is not a recovery.
 */
export const SYNC_RECOVERY_CONFIRM_MS = 10 * 60 * 1000;

export interface SyncHealth {
  recordFailure: (error: unknown) => Promise<void>;
  recordSuccess: () => Promise<void>;
  /** False while an outage has been reported and no recovery confirmed yet. */
  isHealthy: () => boolean;
}

/** The one sync entry point of a matrix-bot-sdk client. */
export interface SyncingClient {
  doSync: (token: string) => Promise<unknown>;
}

interface SyncHealthOptions {
  now?: () => number;
}

const formatOutage = (ms: number): string => {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${String(minutes)}m${String(seconds)}s`
    : `${String(seconds)}s`;
};

/**
 * Tracks whether the Matrix sync loop is alive.
 *
 * The SDK retries a failed sync forever and only writes to its own logger, so
 * a homeserver outage or a rejected token is otherwise invisible: no alert, no
 * umami event, while the app keeps reporting a successful start. This turns a
 * failing streak into a single alert, and reports the recovery once syncs have
 * held for {@link SYNC_RECOVERY_CONFIRM_MS}.
 */
export const createSyncHealth = (
  messageApp: MessageApp,
  options: SyncHealthOptions = {}
): SyncHealth => {
  const now = options.now ?? (() => Date.now());
  let failureCount = 0;
  let firstFailureAt: number | null = null;
  let lastAlertAt: number | null = null;
  let recoveringSince: number | null = null;

  const reset = () => {
    failureCount = 0;
    firstFailureAt = null;
    lastAlertAt = null;
    recoveringSince = null;
  };

  return {
    isHealthy: () => lastAlertAt == null,
    recordFailure: async (error: unknown) => {
      const at = now();
      failureCount += 1;
      firstFailureAt ??= at;
      recoveringSince = null;

      const worthReporting =
        failureCount >= SYNC_ALERT_AFTER_FAILURES ||
        at - firstFailureAt >= SYNC_ALERT_AFTER_MS;
      if (!worthReporting) return;
      if (lastAlertAt != null && at - lastAlertAt < SYNC_REALERT_COOLDOWN_MS)
        return;

      lastAlertAt = at;
      await logError(
        messageApp,
        `Matrix sync failing for ${formatOutage(at - firstFailureAt)} (${String(failureCount)} attempts)`,
        describeMatrixPayload(error)
      );
    },
    recordSuccess: async () => {
      if (lastAlertAt == null) {
        reset();
        return;
      }

      const at = now();
      recoveringSince ??= at;
      if (at - recoveringSince < SYNC_RECOVERY_CONFIRM_MS) return;

      // Syncs stopped failing at the first success, not at this confirmation.
      const outage = recoveringSince - (firstFailureAt ?? recoveringSince);
      reset();
      await logWarning(
        messageApp,
        `Matrix sync recovered after ${formatOutage(outage)}`
      );
    }
  };
};

/**
 * Wraps a client's sync call so each attempt is recorded, then rethrows.
 *
 * The sync loop catches everything internally and logs the error through a
 * string concatenation that renders a Matrix error body as "[object Object]",
 * so this is the only place the real error is still available.
 */
export const attachSyncHealth = (
  client: SyncingClient,
  health: SyncHealth
): void => {
  const doSync = client.doSync.bind(client);

  client.doSync = async (token: string) => {
    try {
      const response = await doSync(token);
      await health.recordSuccess();
      return response;
    } catch (error) {
      await health.recordFailure(error);
      throw error;
    }
  };
};
