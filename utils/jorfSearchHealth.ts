import { MessageApp } from "../types.ts";
import { logErrorForApps, logWarningForApps } from "./debugLogger.ts";
import { formatShortDuration } from "./date.utils.ts";

/** Delay before a still-unreachable JORFSearch is reported again. */
export const JORFSEARCH_REALERT_COOLDOWN_MS = 30 * 60 * 1000;

/** Shown to users whenever a JORFSearch lookup could not be answered. */
export const JORFSEARCH_UNAVAILABLE_TEXT =
  "JORFSearch, le service externe sur lequel JOEL s'appuie pour les recherches, est momentanément indisponible. Veuillez réessayer dans quelques minutes.";

export interface JORFSearchHealth {
  /** Records a request that ran out of attempts against JORFSearch. */
  recordFailure: (
    messageApps: MessageApp[],
    description: string,
    error: unknown
  ) => Promise<void>;
  /** Records a request JORFSearch answered. */
  recordSuccess: () => Promise<void>;
  /** False from the first failed request until JORFSearch answers again. */
  isHealthy: () => boolean;
}

interface JORFSearchHealthOptions {
  now?: () => number;
}

/**
 * Tracks whether JORFSearch is reachable, across every app and request kind.
 *
 * Each user lookup otherwise reported its own failure, so one outage produced
 * an alert per search. This turns an outage into one alert, a reminder every
 * {@link JORFSEARCH_REALERT_COOLDOWN_MS}, and a recovery message with its
 * length. The cooldown outlives the outage, so a source that flaps within it
 * stays on the first alert.
 */
export const createJORFSearchHealth = (
  options: JORFSearchHealthOptions = {}
): JORFSearchHealth => {
  const now = options.now ?? (() => Date.now());
  let outageStartedAt: number | null = null;
  let failedRequests = 0;
  let affectedApps = new Set<MessageApp>();
  let outageReported = false;
  let lastAlertAt: number | null = null;

  return {
    isHealthy: () => outageStartedAt == null,
    recordFailure: async (messageApps, description, error) => {
      const at = now();
      outageStartedAt ??= at;
      failedRequests += 1;
      for (const app of messageApps) affectedApps.add(app);

      if (
        lastAlertAt != null &&
        at - lastAlertAt < JORFSEARCH_REALERT_COOLDOWN_MS
      )
        return;

      const message = outageReported
        ? `JORFSearch still unreachable after ${formatShortDuration(at - outageStartedAt)} (${String(failedRequests)} failed requests so far)`
        : `JORFSearch unreachable: ${description}. Further requests fail fast until it answers again.`;
      lastAlertAt = at;
      outageReported = true;
      await logErrorForApps([...affectedApps], message, error);
    },
    recordSuccess: async () => {
      if (outageStartedAt == null) return;

      const outage = now() - outageStartedAt;
      const reported = outageReported;
      const requests = failedRequests;
      const apps = [...affectedApps];
      outageStartedAt = null;
      failedRequests = 0;
      affectedApps = new Set();
      outageReported = false;

      if (!reported) return;
      await logWarningForApps(
        apps,
        `JORFSearch recovered after ${formatShortDuration(outage)} (${String(requests)} failed requests)`
      );
    }
  };
};

/** The process-wide tracker shared by every JORFSearch call site. */
export let jorfSearchHealth = createJORFSearchHealth();

/** Test seam: forgets any outage in progress. */
export function resetJORFSearchHealth(): void {
  jorfSearchHealth = createJORFSearchHealth();
}
