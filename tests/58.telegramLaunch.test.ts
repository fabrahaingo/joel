import { describe, it, expect } from "vitest";
import {
  isTelegramConflict,
  launchWithConflictRetry,
  pollingProbe
} from "../utils/telegramLaunch.ts";

const conflictError = (): Error =>
  Object.assign(
    new Error(
      "409: Conflict: terminated by other getUpdates request; make sure that only one bot instance is running"
    ),
    { code: 409 }
  );

const apiError = (code: number, description: string): Error =>
  Object.assign(new Error(`${String(code)}: ${description}`), { code });

describe("isTelegramConflict", () => {
  it("recognises the 409 raised when another instance polls the same token", () => {
    expect(isTelegramConflict(conflictError())).toBe(true);
  });

  it("ignores other Telegram API errors", () => {
    expect(isTelegramConflict(apiError(401, "Unauthorized"))).toBe(false);
  });

  it("ignores values that carry no status code", () => {
    expect(isTelegramConflict(new Error("socket hang up"))).toBe(false);
    expect(isTelegramConflict("409")).toBe(false);
  });
});

describe("launchWithConflictRetry", () => {
  it("retries until the competing instance releases the token", async () => {
    const sleeps: number[] = [];
    let attempts = 0;

    await launchWithConflictRetry({
      launch: () => {
        attempts += 1;
        return attempts < 3
          ? Promise.reject(conflictError())
          : Promise.resolve();
      },
      delaysMs: [10, 20, 30],
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      }
    });

    expect(attempts).toBe(3);
    expect(sleeps).toEqual([10, 20]);
  });

  it("rethrows the conflict once every delay is spent", async () => {
    let attempts = 0;

    await expect(
      launchWithConflictRetry({
        launch: () => {
          attempts += 1;
          return Promise.reject(conflictError());
        },
        delaysMs: [10, 20],
        sleep: () => Promise.resolve()
      })
    ).rejects.toThrow("409: Conflict");

    expect(attempts).toBe(3);
  });

  it("does not retry an error that is not a conflict", async () => {
    let attempts = 0;

    await expect(
      launchWithConflictRetry({
        launch: () => {
          attempts += 1;
          return Promise.reject(apiError(401, "Unauthorized"));
        },
        delaysMs: [10, 20],
        sleep: () => Promise.resolve()
      })
    ).rejects.toThrow("401: Unauthorized");

    expect(attempts).toBe(1);
  });

  it("reports each conflict with the attempt number and the coming delay", async () => {
    const reported: { attempt: number; delayMs: number }[] = [];
    let attempts = 0;

    await launchWithConflictRetry({
      launch: () => {
        attempts += 1;
        return attempts < 2
          ? Promise.reject(conflictError())
          : Promise.resolve();
      },
      delaysMs: [10, 20],
      sleep: () => Promise.resolve(),
      onConflict: (attempt, delayMs) => {
        reported.push({ attempt, delayMs });
      }
    });

    expect(reported).toEqual([{ attempt: 1, delayMs: 10 }]);
  });
});

describe("pollingProbe", () => {
  it("passes while long polling runs", () => {
    expect(pollingProbe(() => true)()).toEqual({ ok: true });
  });

  it("fails with a detail once polling stopped", () => {
    expect(pollingProbe(() => false)()).toEqual({
      ok: false,
      detail: "Telegram long polling stopped"
    });
  });
});
