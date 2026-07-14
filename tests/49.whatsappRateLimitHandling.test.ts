import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// WhatsAppSession reads WHATSAPP_PHONE_ID at module load.
vi.hoisted(() => {
  process.env.WHATSAPP_PHONE_ID = "TEST_PHONE_ID";
});

vi.mock("../utils/debugLogger.ts", () => ({
  logError: vi.fn(() => Promise.resolve()),
  logWarning: vi.fn(() => Promise.resolve())
}));
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn() }
}));
vi.mock("../models/User.ts", () => ({
  default: {
    findOne: vi.fn(() => ({ lean: () => Promise.resolve(null) })),
    updateOne: vi.fn(() => Promise.resolve({}))
  }
}));

import {
  handleWhatsAppAPIErrors,
  sendWhatsAppMessage
} from "../entities/WhatsAppSession.ts";
import { logError, logWarning } from "../utils/debugLogger.ts";
import type { ExtendedMiniUserInfo } from "../entities/Session.ts";
import type { WhatsAppAPI } from "whatsapp-api-js/middleware/express";

const logErrorMock = logError as unknown as ReturnType<typeof vi.fn>;
const logWarningMock = logWarning as unknown as ReturnType<typeof vi.fn>;

const HOUR_MS = 60 * 60 * 1000;
const MAX_MESSAGE_RETRY = 5;

const waUser = (): ExtendedMiniUserInfo => ({
  messageApp: "WhatsApp",
  chatId: "lock-" + Math.random().toString(36).slice(2),
  status: "active",
  hasAccount: true,
  waitingReengagement: false,
  lastEngagementAt: new Date(Date.now() - 1 * HOUR_MS)
});

beforeEach(() => {
  vi.clearAllMocks();
  // Make cooldown/backoff sleeps instant.
  vi.stubGlobal("setTimeout", (fn: () => void) => {
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleWhatsAppAPIErrors — rate-limit severity", () => {
  it("logs a 131056 abort as a warning, not an error", async () => {
    const res = await handleWhatsAppAPIErrors(
      { errorCode: 131056 },
      "sendWhatsAppMessage",
      "33678613826",
      vi.fn(() => Promise.resolve()),
      { retryFunction: vi.fn(), retryNumber: MAX_MESSAGE_RETRY }
    );
    expect(res).toBe(false);
    expect(logWarningMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("logs a 131048 abort as a warning", async () => {
    await handleWhatsAppAPIErrors(
      { errorCode: 131048 },
      "sendWhatsAppMessage",
      "33600000000",
      vi.fn(() => Promise.resolve()),
      { retryFunction: vi.fn(), retryNumber: MAX_MESSAGE_RETRY }
    );
    expect(logWarningMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("keeps a genuine transient (130429) abort at error severity", async () => {
    await handleWhatsAppAPIErrors(
      { errorCode: 130429 },
      "sendWhatsAppMessage",
      "33600000000",
      vi.fn(() => Promise.resolve()),
      { retryFunction: vi.fn(), retryNumber: MAX_MESSAGE_RETRY }
    );
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logWarningMock).not.toHaveBeenCalled();
  });
});

describe("sendWhatsAppMessage — per-recipient serialization", () => {
  const opts = { hasAccount: true, useAsyncUmamiLog: false };

  it("serializes concurrent sends to the same chatId", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    let call = 0;
    const sendMessage = vi.fn(async () => {
      call++;
      const id = call;
      events.push(`start${String(id)}`);
      if (id === 1) await gate; // hold the first send open
      events.push(`end${String(id)}`);
      return { messages: [{ id: "ok" }] };
    });
    const api = { sendMessage } as unknown as WhatsAppAPI;
    const user = waUser(); // same chatId for both sends

    const p1 = sendWhatsAppMessage(api, user, "m1", opts);
    const p2 = sendWhatsAppMessage(api, user, "m2", opts);

    await Promise.resolve();
    await Promise.resolve();
    // The second send must not have started while the first holds the lock.
    expect(events).toEqual(["start1"]);

    releaseFirst();
    await Promise.all([p1, p2]);
    expect(events).toEqual(["start1", "end1", "start2", "end2"]);
  });

  it("allows concurrent sends to different chatIds", async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const sendMessage = vi.fn(async () => {
      events.push("start");
      await gate;
      return { messages: [{ id: "ok" }] };
    });
    const api = { sendMessage } as unknown as WhatsAppAPI;

    const p1 = sendWhatsAppMessage(api, waUser(), "m", opts);
    const p2 = sendWhatsAppMessage(api, waUser(), "m", opts);

    await Promise.resolve();
    await Promise.resolve();
    // Different recipients run in parallel — both in flight before either resolves.
    expect(events.filter((e) => e === "start")).toHaveLength(2);

    release();
    await Promise.all([p1, p2]);
  });
});
