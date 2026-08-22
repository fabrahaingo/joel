import { describe, it, expect, vi, beforeEach } from "vitest";

const { logErrorSpy, logWarningSpy } = vi.hoisted(() => ({
  logErrorSpy: vi.fn(() => Promise.resolve()),
  logWarningSpy: vi.fn(() => Promise.resolve())
}));

vi.mock("../utils/debugLogger.ts", () => ({
  logError: logErrorSpy,
  logWarning: logWarningSpy
}));

const {
  attachSyncHealth,
  createSyncHealth,
  SYNC_ALERT_AFTER_FAILURES,
  SYNC_ALERT_AFTER_MS,
  SYNC_REALERT_COOLDOWN_MS,
  SYNC_RECOVERY_CONFIRM_MS
} = await import("../utils/matrixSyncHealth.ts");

const tokenError = () => ({
  errcode: "M_UNKNOWN",
  error: "Unable to introspect the access token"
});

const alertTexts = () =>
  logErrorSpy.mock.calls.map((call) => (call as unknown as string[]).join(" "));

const recoveryTexts = () =>
  logWarningSpy.mock.calls.map((call) =>
    (call as unknown as string[]).join(" ")
  );

let clock: number;

const healthWithClock = () => createSyncHealth("Tchap", { now: () => clock });

beforeEach(() => {
  vi.clearAllMocks();
  clock = 0;
});

describe("sync health alerting", () => {
  it("stays quiet while failures are below the threshold", async () => {
    const health = healthWithClock();

    for (let i = 0; i < SYNC_ALERT_AFTER_FAILURES - 1; i++) {
      clock += 1000;
      await health.recordFailure(tokenError());
    }

    expect(logErrorSpy).not.toHaveBeenCalled();
  });

  it("alerts once when the failures pile up, naming the errcode", async () => {
    const health = healthWithClock();

    for (let i = 0; i < SYNC_ALERT_AFTER_FAILURES + 5; i++) {
      clock += 1000;
      await health.recordFailure(tokenError());
    }

    expect(logErrorSpy).toHaveBeenCalledTimes(1);
    const alert = alertTexts()[0];
    expect(alert).toContain("Tchap");
    expect(alert).toContain("Unable to introspect the access token");
    expect(alert).not.toContain("[object Object]");
  });

  it("alerts on a short but long-lasting outage", async () => {
    const health = healthWithClock();

    await health.recordFailure(tokenError());
    clock += SYNC_ALERT_AFTER_MS + 1;
    await health.recordFailure(tokenError());

    expect(logErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("re-alerts only once the cooldown has elapsed", async () => {
    const health = healthWithClock();

    for (let i = 0; i < SYNC_ALERT_AFTER_FAILURES; i++) {
      clock += 1000;
      await health.recordFailure(tokenError());
    }
    expect(logErrorSpy).toHaveBeenCalledTimes(1);

    clock += SYNC_REALERT_COOLDOWN_MS - 1;
    await health.recordFailure(tokenError());
    expect(logErrorSpy).toHaveBeenCalledTimes(1);

    clock += 2;
    await health.recordFailure(tokenError());
    expect(logErrorSpy).toHaveBeenCalledTimes(2);
  });

  it("reports recovery once syncs have held for the confirmation window", async () => {
    const health = healthWithClock();

    for (let i = 0; i < SYNC_ALERT_AFTER_FAILURES; i++) {
      clock += 60_000;
      await health.recordFailure(tokenError());
    }
    await health.recordSuccess();
    expect(logWarningSpy).not.toHaveBeenCalled();

    clock += SYNC_RECOVERY_CONFIRM_MS;
    await health.recordSuccess();

    expect(logWarningSpy).toHaveBeenCalledTimes(1);
    expect(recoveryTexts()[0]).toContain("recovered");
  });

  it("measures the outage up to the first success, not the confirmation", async () => {
    const health = healthWithClock();

    await health.recordFailure(tokenError());
    clock += 4 * 60_000;
    await health.recordFailure(tokenError());
    await health.recordSuccess();

    clock += SYNC_RECOVERY_CONFIRM_MS * 3;
    await health.recordSuccess();

    expect(recoveryTexts()[0]).toContain("recovered after 4m0s");
  });

  it("stays on one incident while sync flaps", async () => {
    const health = healthWithClock();

    // Two flap cycles, kept inside SYNC_REALERT_COOLDOWN_MS so the only thing
    // that could speak up is the flapping itself.
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < SYNC_ALERT_AFTER_FAILURES; i++) {
        clock += 30_000;
        await health.recordFailure(tokenError());
      }
      await health.recordSuccess();
      clock += SYNC_RECOVERY_CONFIRM_MS - 60_000;
      await health.recordSuccess();
    }

    expect(logErrorSpy).toHaveBeenCalledTimes(1);
    expect(logWarningSpy).not.toHaveBeenCalled();
  });

  it("keeps the re-alert cooldown across a brief success", async () => {
    const health = healthWithClock();

    for (let i = 0; i < SYNC_ALERT_AFTER_FAILURES; i++) {
      clock += 1000;
      await health.recordFailure(tokenError());
    }
    expect(logErrorSpy).toHaveBeenCalledTimes(1);
    const alertedAt = clock;

    await health.recordSuccess();
    clock = alertedAt + SYNC_REALERT_COOLDOWN_MS - 1;
    await health.recordFailure(tokenError());
    expect(logErrorSpy).toHaveBeenCalledTimes(1);

    clock += 2;
    await health.recordFailure(tokenError());
    expect(logErrorSpy).toHaveBeenCalledTimes(2);
  });

  it("says nothing on a success that follows no alert", async () => {
    const health = healthWithClock();

    await health.recordFailure(tokenError());
    await health.recordSuccess();

    expect(logWarningSpy).not.toHaveBeenCalled();
    expect(logErrorSpy).not.toHaveBeenCalled();
  });

  it("starts a fresh streak after a confirmed recovery", async () => {
    const health = healthWithClock();

    for (let i = 0; i < SYNC_ALERT_AFTER_FAILURES; i++) {
      clock += 1000;
      await health.recordFailure(tokenError());
    }
    await health.recordSuccess();
    clock += SYNC_RECOVERY_CONFIRM_MS;
    await health.recordSuccess();

    for (let i = 0; i < SYNC_ALERT_AFTER_FAILURES - 1; i++) {
      clock += 1000;
      await health.recordFailure(tokenError());
    }
    expect(logErrorSpy).toHaveBeenCalledTimes(1);

    clock += 1000;
    await health.recordFailure(tokenError());
    expect(logErrorSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps a node network error readable", async () => {
    const health = healthWithClock();

    for (let i = 0; i < SYNC_ALERT_AFTER_FAILURES; i++) {
      clock += 1000;
      await health.recordFailure(new Error("read ECONNRESET"));
    }

    expect(alertTexts()[0]).toContain("read ECONNRESET");
  });
});

describe("attachSyncHealth", () => {
  const fakeClient = (doSync: (token: string) => Promise<unknown>) => ({
    doSync
  });

  it("passes the sync response through untouched", async () => {
    const client = fakeClient(() => Promise.resolve({ next_batch: "s42" }));
    attachSyncHealth(client, healthWithClock());

    await expect(client.doSync("s41")).resolves.toEqual({ next_batch: "s42" });
  });

  it("rethrows a sync failure so the SDK keeps its own backoff", async () => {
    const failure = new Error("read ECONNRESET");
    const client = fakeClient(() => Promise.reject(failure));
    attachSyncHealth(client, healthWithClock());

    await expect(client.doSync("s41")).rejects.toBe(failure);
  });

  it("alerts once the failed syncs pile up", async () => {
    const client = fakeClient(() => Promise.reject(new Error("boom")));
    attachSyncHealth(client, healthWithClock());

    for (let i = 0; i < SYNC_ALERT_AFTER_FAILURES; i++) {
      clock += 1000;
      await expect(client.doSync("s41")).rejects.toThrow("boom");
    }

    expect(logErrorSpy).toHaveBeenCalledTimes(1);
    expect(alertTexts()[0]).toContain("boom");
  });

  it("reports the recovery once the syncs keep succeeding", async () => {
    let fail = true;
    const client = fakeClient(() =>
      fail ? Promise.reject(new Error("boom")) : Promise.resolve({})
    );
    attachSyncHealth(client, healthWithClock());

    for (let i = 0; i < SYNC_ALERT_AFTER_FAILURES; i++) {
      clock += 1000;
      await expect(client.doSync("s41")).rejects.toThrow("boom");
    }
    fail = false;
    await client.doSync("s41");
    clock += SYNC_RECOVERY_CONFIRM_MS;
    await client.doSync("s42");

    expect(logWarningSpy).toHaveBeenCalledTimes(1);
  });
});

describe("sync health readiness", () => {
  it("is healthy before any failure", () => {
    expect(healthWithClock().isHealthy()).toBe(true);
  });

  it("stays healthy while failures are below the alert threshold", async () => {
    const health = healthWithClock();

    for (let i = 0; i < SYNC_ALERT_AFTER_FAILURES - 1; i++) {
      clock += 1000;
      await health.recordFailure(tokenError());
    }

    expect(health.isHealthy()).toBe(true);
  });

  it("turns unhealthy once the outage is reported", async () => {
    const health = healthWithClock();

    for (let i = 0; i < SYNC_ALERT_AFTER_FAILURES; i++) {
      clock += 1000;
      await health.recordFailure(tokenError());
    }

    expect(health.isHealthy()).toBe(false);
  });

  it("stays unhealthy until the recovery is confirmed", async () => {
    const health = healthWithClock();

    for (let i = 0; i < SYNC_ALERT_AFTER_FAILURES; i++) {
      clock += 1000;
      await health.recordFailure(tokenError());
    }
    await health.recordSuccess();
    expect(health.isHealthy()).toBe(false);

    clock += SYNC_RECOVERY_CONFIRM_MS;
    await health.recordSuccess();
    expect(health.isHealthy()).toBe(true);
  });
});
