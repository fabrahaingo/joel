import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// WhatsAppSession reads WHATSAPP_PHONE_ID at module load (vi.hoisted runs first).
vi.hoisted(() => {
  process.env.WHATSAPP_PHONE_ID = "TEST_PHONE_ID";
});

// Keep analytics + DB writes inert. handleWhatsAppAPIErrors and
// recordSuccessfulDelivery both touch the User model; stub it so the send path
// runs without a database.
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn() }
}));
vi.mock("../models/User.ts", () => ({
  default: {
    findOne: vi.fn(() => ({ lean: () => Promise.resolve(null) })),
    updateOne: vi.fn(() => Promise.resolve({}))
  }
}));

import { sendWhatsAppMessage } from "../entities/WhatsAppSession.ts";
import { sendSignalAppMessage } from "../entities/SignalSession.ts";
import { markdown2WHMarkdown, splitText } from "../utils/text.utils.ts";
import {
  WHATSAPP_MESSAGE_CHAR_LIMIT,
  WHATSAPP_MAX_LINES
} from "../entities/WhatsAppSession.ts";
import { SIGNAL_MESSAGE_CHAR_LIMIT } from "../entities/SignalSession.ts";
import type { ExtendedMiniUserInfo } from "../entities/Session.ts";
import type { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import type { SignalCli } from "signal-sdk";

const HOUR_MS = 60 * 60 * 1000;

const waUser = (): ExtendedMiniUserInfo => ({
  messageApp: "WhatsApp",
  // In window: lastEngagement just now so the re-engagement guard lets us through.
  chatId: "resume-" + Math.random().toString(36).slice(2),
  status: "active",
  hasAccount: true,
  waitingReengagement: false,
  lastEngagementAt: new Date(Date.now() - 1 * HOUR_MS)
});

// A long, multi-line body that splits into several WhatsApp chunks.
const longBody = Array.from(
  { length: 60 },
  (_, n) => `line number ${String(n)} with some filler content to add length`
).join("\n");

// Make all setTimeout-based sleeps (cooldowns + retry backoff) instant, and
// record the delays so we can assert the backoff cap.
let recordedDelays: number[] = [];
beforeEach(() => {
  recordedDelays = [];
  vi.stubGlobal("setTimeout", (fn: () => void, ms?: number) => {
    recordedDelays.push(ms ?? 0);
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("sendWhatsAppMessage — resume from failed chunk", () => {
  it("on a transient mid-message failure, resumes from the failed chunk without resending delivered chunks", async () => {
    const chunks = splitText(
      markdown2WHMarkdown(longBody),
      WHATSAPP_MESSAGE_CHAR_LIMIT,
      WHATSAPP_MAX_LINES
    );
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    // Fail exactly once, on the 3rd send (chunk index 2's first attempt) with a
    // transient pair-rate-limit (131056); succeed on every other call.
    let n = 0;
    const sendMessage = vi.fn(() => {
      n++;
      if (n === 3) return Promise.resolve({ error: { code: 131056 } });
      return Promise.resolve({ messages: [{ id: "ok" }] });
    });
    const api = { sendMessage } as unknown as WhatsAppAPI;

    const res = await sendWhatsAppMessage(api, waUser(), longBody, {
      hasAccount: true,
      useAsyncUmamiLog: false
    });

    expect(res).toBe(true);
    // Resume: chunks 0..1 sent once, chunk 2 sent twice (fail+retry), rest once.
    // => total = chunks.length + 1. The old whole-resend bug would have produced
    // chunks.length + (failed index) extra sends (>= chunks.length + 2).
    expect(sendMessage).toHaveBeenCalledTimes(chunks.length + 1);
  });

  it("caps retry backoff and aborts after exactly MAX_MESSAGE_RETRY (5) retries", async () => {
    // Single-chunk message that always fails with a transient code.
    const sendMessage = vi.fn(() =>
      Promise.resolve({ error: { code: 131056 } })
    );
    const api = { sendMessage } as unknown as WhatsAppAPI;

    const res = await sendWhatsAppMessage(api, waUser(), "short message", {
      hasAccount: true,
      useAsyncUmamiLog: false
    });

    expect(res).toBe(false);
    // Initial attempt + 5 retries = 6 sends, then abort.
    expect(sendMessage).toHaveBeenCalledTimes(6);
    // Every backoff (and cooldown) stayed under the cap + max jitter. Uncapped
    // 4^5 backoff would have been 1_024_000ms.
    expect(Math.max(...recordedDelays)).toBeLessThanOrEqual(60_000 + 1000);
  });
});

describe("sendSignalAppMessage — resume from failed chunk", () => {
  // Distinct per-chunk content so we can detect a duplicated chunk by value.
  const signalBody =
    "A".repeat(SIGNAL_MESSAGE_CHAR_LIMIT) +
    "B".repeat(SIGNAL_MESSAGE_CHAR_LIMIT) +
    "C".repeat(100); // 3 chunks

  it("resumes from the failed chunk instead of losing the remainder", async () => {
    const chunks = splitText(signalBody, SIGNAL_MESSAGE_CHAR_LIMIT);
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    const sentTexts: string[] = [];
    let n = 0;
    const send = vi.fn((_phone: string, text: string) => {
      n++;
      sentTexts.push(text);
      if (n === 2) return Promise.reject(new Error("transient signal error"));
      return Promise.resolve({});
    });
    const signalCli = { sendMessage: send } as unknown as SignalCli;

    const res = await sendSignalAppMessage(
      signalCli,
      "33600000000",
      signalBody,
      {
        useAsyncUmamiLog: false,
        hasAccount: true
      }
    );

    expect(res).toBe(true);
    // chunk0 once, chunk1 twice (fail+retry), chunk2 once => chunks.length + 1.
    expect(send).toHaveBeenCalledTimes(chunks.length + 1);
    // The first chunk was delivered exactly once (no duplicate on resume).
    expect(sentTexts.filter((t) => t === chunks[0])).toHaveLength(1);
  });

  it("gives up (false) after exhausting retries on persistent failure", async () => {
    const send = vi.fn(() =>
      Promise.reject(new Error("persistent signal error"))
    );
    const signalCli = { sendMessage: send } as unknown as SignalCli;

    const res = await sendSignalAppMessage(signalCli, "33600000000", "short", {
      useAsyncUmamiLog: false,
      hasAccount: true
    });

    expect(res).toBe(false);
    // Initial attempt + MAX_SIGNAL_MESSAGE_RETRY (3) retries = 4 sends.
    expect(send).toHaveBeenCalledTimes(4);
  });
});
