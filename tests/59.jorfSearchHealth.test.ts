import { describe, it, expect, vi, beforeEach } from "vitest";

const { logErrorForAppsSpy, logWarningForAppsSpy } = vi.hoisted(() => ({
  logErrorForAppsSpy: vi.fn(() => Promise.resolve()),
  logWarningForAppsSpy: vi.fn(() => Promise.resolve())
}));

vi.mock("../utils/debugLogger.ts", () => ({
  logErrorForApps: logErrorForAppsSpy,
  logWarningForApps: logWarningForAppsSpy
}));

const { createJORFSearchHealth, JORFSEARCH_REALERT_COOLDOWN_MS } =
  await import("../utils/jorfSearchHealth.ts");

const refused = () => new Error("connect ECONNREFUSED 95.216.0.254:443");

const alertTexts = () =>
  logErrorForAppsSpy.mock.calls.map((call) => String((call as unknown[])[1]));

const recoveryTexts = () =>
  logWarningForAppsSpy.mock.calls.map((call) => String((call as unknown[])[1]));

let clock: number;

const healthWithClock = () => createJORFSearchHealth({ now: () => clock });

beforeEach(() => {
  vi.clearAllMocks();
  clock = 0;
});

describe("JORFSearch health", () => {
  it("is healthy until a request exhausts its attempts", async () => {
    const health = healthWithClock();
    expect(health.isHealthy()).toBe(true);

    await health.recordFailure(
      ["Telegram"],
      "people request failed",
      refused()
    );

    expect(health.isHealthy()).toBe(false);
  });

  it("alerts once for a run of failed requests, whatever the app", async () => {
    const health = healthWithClock();

    await health.recordFailure(
      ["Telegram"],
      "people request failed",
      refused()
    );
    for (let i = 0; i < 7; i++) {
      clock += 60_000;
      await health.recordFailure(
        ["WhatsApp"],
        "people request failed",
        refused()
      );
    }

    expect(logErrorForAppsSpy).toHaveBeenCalledTimes(1);
    expect(alertTexts()[0]).toContain("people request failed");
    expect(logErrorForAppsSpy.mock.calls[0]).toContainEqual(["Telegram"]);
  });

  it("re-alerts once the cooldown has elapsed, with the running totals", async () => {
    const health = healthWithClock();

    await health.recordFailure(
      ["Telegram"],
      "people request failed",
      refused()
    );
    clock += JORFSEARCH_REALERT_COOLDOWN_MS - 1;
    await health.recordFailure(
      ["Signal"],
      "reference request failed",
      refused()
    );
    expect(logErrorForAppsSpy).toHaveBeenCalledTimes(1);

    clock += 2;
    await health.recordFailure(
      ["Telegram"],
      "people request failed",
      refused()
    );

    expect(logErrorForAppsSpy).toHaveBeenCalledTimes(2);
    expect(alertTexts()[1]).toContain("still unreachable after 30m0s");
    expect(alertTexts()[1]).toContain("3 failed requests");
    expect(logErrorForAppsSpy.mock.calls[1]).toContainEqual([
      "Telegram",
      "Signal"
    ]);
  });

  it("reports the recovery with the outage length and failed requests", async () => {
    const health = healthWithClock();

    await health.recordFailure(
      ["Telegram"],
      "people request failed",
      refused()
    );
    clock += 76 * 60_000;
    await health.recordFailure(
      ["Telegram"],
      "people request failed",
      refused()
    );
    clock += 60_000;
    await health.recordSuccess();

    expect(health.isHealthy()).toBe(true);
    expect(logWarningForAppsSpy).toHaveBeenCalledTimes(1);
    expect(recoveryTexts()[0]).toContain("recovered after 77m0s");
    expect(recoveryTexts()[0]).toContain("2 failed requests");
  });

  it("says nothing on a success while healthy", async () => {
    const health = healthWithClock();

    await health.recordSuccess();

    expect(logWarningForAppsSpy).not.toHaveBeenCalled();
    expect(logErrorForAppsSpy).not.toHaveBeenCalled();
  });

  it("keeps a flapping source on one alert within the cooldown", async () => {
    const health = healthWithClock();

    for (let round = 0; round < 3; round++) {
      await health.recordFailure(
        ["Telegram"],
        "people request failed",
        refused()
      );
      clock += 60_000;
      await health.recordSuccess();
      clock += 60_000;
    }

    expect(logErrorForAppsSpy).toHaveBeenCalledTimes(1);
    // Only the reported outage gets a recovery; the silent ones close silently.
    expect(logWarningForAppsSpy).toHaveBeenCalledTimes(1);
  });

  it("alerts a new outage that starts after the cooldown", async () => {
    const health = healthWithClock();

    await health.recordFailure(
      ["Telegram"],
      "people request failed",
      refused()
    );
    await health.recordSuccess();
    clock += JORFSEARCH_REALERT_COOLDOWN_MS;
    await health.recordFailure(
      ["Telegram"],
      "people request failed",
      refused()
    );

    expect(logErrorForAppsSpy).toHaveBeenCalledTimes(2);
    expect(alertTexts()[1]).not.toContain("still unreachable");
  });
});
