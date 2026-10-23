import { describe, it, expect, beforeEach, vi } from "vitest";

const { getSpy, logErrorForAppsSpy, logWarningForAppsSpy } = vi.hoisted(() => ({
  getSpy: vi.fn(),
  logErrorForAppsSpy: vi.fn(() => Promise.resolve()),
  logWarningForAppsSpy: vi.fn(() => Promise.resolve())
}));

// Keep the real `isAxiosError` so shouldRetry keeps working.
vi.mock("axios", async (importActual) => {
  const actual = await importActual<typeof import("axios")>();
  return {
    ...actual,
    default: {
      ...(actual.default as object),
      create: () => ({ get: getSpy, post: vi.fn() })
    },
    isAxiosError: actual.isAxiosError
  };
});
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn(() => Promise.resolve()) }
}));
vi.mock("../utils/debugLogger.ts", () => ({
  logError: vi.fn(() => Promise.resolve()),
  logWarning: vi.fn(() => Promise.resolve()),
  logErrorForApps: logErrorForAppsSpy,
  logWarningForApps: logWarningForAppsSpy
}));

import {
  callJORFSearchPeople,
  callJORFSearchReference,
  searchOrganisationWikidataId
} from "../utils/JORFSearch.utils.ts";
import {
  jorfSearchHealth,
  resetJORFSearchHealth
} from "../utils/jorfSearchHealth.ts";
import { RETRY_MAX } from "../utils/httpRetry.utils.ts";

const networkError = (message = "connect ECONNREFUSED 95.216.0.254:443") =>
  Object.assign(new Error(message), {
    isAxiosError: true,
    code: "ECONNREFUSED",
    toJSON: () => ({})
  });

const httpError = (status: number) =>
  Object.assign(
    new Error(`Request failed with status code ${String(status)}`),
    {
      isAxiosError: true,
      response: { status },
      toJSON: () => ({})
    }
  );

/** Drives the retry back-off without spending the test's wall-clock on it. */
async function withFakeTimers<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const pending = run();
    await vi.runAllTimersAsync();
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

const alertTexts = () =>
  logErrorForAppsSpy.mock.calls.map((call) => String((call as unknown[])[1]));

beforeEach(() => {
  vi.clearAllMocks();
  resetJORFSearchHealth();
});

describe("JORFSearch outage", () => {
  it("alerts once and fails fast for every lookup after the first", async () => {
    getSpy.mockRejectedValue(networkError());

    const results = [];
    for (const app of ["Telegram", "WhatsApp", "Telegram"] as const) {
      results.push(
        await withFakeTimers(() => callJORFSearchPeople("Jean Dupont", app))
      );
    }

    expect(results).toEqual([null, null, null]);
    expect(getSpy).toHaveBeenCalledTimes(RETRY_MAX + 1 + 2);
    expect(logErrorForAppsSpy).toHaveBeenCalledTimes(1);
    expect(alertTexts()[0]).toContain(
      `people request failed after ${String(RETRY_MAX + 1)} attempts`
    );
    expect(alertTexts()[0]).not.toContain("Dupont");
  });

  it("shares the outage across request kinds", async () => {
    getSpy.mockRejectedValue(networkError());

    await withFakeTimers(() => callJORFSearchPeople("Jean Dupont", "Telegram"));
    getSpy.mockClear();
    await withFakeTimers(() =>
      callJORFSearchReference("JORFTEXT000052060473", "Signal")
    );

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(logErrorForAppsSpy).toHaveBeenCalledTimes(1);
  });

  it("reports the recovery on the first answer and retries fully again", async () => {
    getSpy.mockRejectedValue(networkError());
    await withFakeTimers(() => callJORFSearchPeople("Jean Dupont", "Telegram"));

    getSpy.mockResolvedValue({ data: [], request: {} });
    await callJORFSearchPeople("Jean Dupont", "Telegram");

    expect(jorfSearchHealth.isHealthy()).toBe(true);
    expect(logWarningForAppsSpy).toHaveBeenCalledTimes(1);
    expect(
      String((logWarningForAppsSpy.mock.calls[0] as unknown[])[1])
    ).toContain("JORFSearch recovered");

    getSpy.mockReset();
    getSpy.mockRejectedValue(networkError());
    await withFakeTimers(() => callJORFSearchPeople("Jean Dupont", "Telegram"));
    expect(getSpy).toHaveBeenCalledTimes(RETRY_MAX + 1);
  });

  it("signals each retry so the caller can keep the user informed", async () => {
    getSpy.mockRejectedValue(networkError());
    const onRetry = vi.fn();

    await withFakeTimers(() =>
      callJORFSearchPeople("Jean Dupont", "Telegram", { onRetry })
    );

    expect(onRetry).toHaveBeenCalledTimes(RETRY_MAX);
  });

  it("does not open an outage on a client error", async () => {
    getSpy.mockRejectedValue(httpError(404));

    await callJORFSearchPeople("Jean Dupont", "Telegram");

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(jorfSearchHealth.isHealthy()).toBe(true);
    expect(alertTexts()[0]).toContain("Error in callJORFSearchPeople");
  });

  it("does not blame JORFSearch when Wikidata is the one down", async () => {
    getSpy.mockRejectedValue(networkError());

    const result = await withFakeTimers(() =>
      searchOrganisationWikidataId("Conseil d'Etat", "Telegram")
    );

    expect(result).toBeNull();
    expect(jorfSearchHealth.isHealthy()).toBe(true);
    expect(getSpy).toHaveBeenCalledTimes(RETRY_MAX + 1);
    expect(alertTexts()[0]).toContain(
      `Wikidata request failed after ${String(RETRY_MAX + 1)} attempts`
    );
  });
});
