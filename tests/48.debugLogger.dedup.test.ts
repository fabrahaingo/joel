import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// debugLogger captures DEBUG_CHAT_ID / TELEGRAM_DEBUG_BOT_TOKEN into module-level
// consts at import time, so they must be set before the module loads.
vi.hoisted(() => {
  process.env.DEBUG_CHAT_ID = "12345";
  process.env.TELEGRAM_DEBUG_BOT_TOKEN = "debug-bot-token-abcdefgh";
});

vi.mock("axios", () => {
  const post = vi.fn(() => Promise.resolve({ data: {} }));
  const get = vi.fn(() => Promise.resolve({ data: {} }));
  const instance = { post, get };
  return {
    default: {
      post,
      get,
      create: vi.fn(() => instance),
      isAxiosError: () => false
    }
  };
});
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn() }
}));

import axios from "axios";
import { logError, resetAlertDedupState } from "../utils/debugLogger.ts";

const post = axios.post as unknown as ReturnType<typeof vi.fn>;

let nowMs = 1_000_000;

beforeEach(() => {
  process.env.DEBUG_ALERT_DEDUP_WINDOW_SECONDS = "300";
  resetAlertDedupState();
  post.mockClear();
  nowMs = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => nowMs);
  // Make the inter-message cooldown sleep instant.
  vi.stubGlobal("setTimeout", (fn: () => void) => {
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("debug alert de-duplication", () => {
  it("suppresses identical-signature alerts within the window (digits normalized)", async () => {
    // Same message, different chatId/counts — digits are stripped for the signature.
    await logError(
      "WhatsApp",
      "WH API error 131056 aborted after 5 retries in sendWhatsAppMessage to 33678613826"
    );
    await logError(
      "WhatsApp",
      "WH API error 131056 aborted after 5 retries in sendWhatsAppMessage to 33111111111"
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("re-alerts after the window elapses, prefixing the suppressed count", async () => {
    await logError("WhatsApp", "JORFSearch request for people aborted after 5 tries");
    await logError("WhatsApp", "JORFSearch request for people aborted after 5 tries");
    await logError("WhatsApp", "JORFSearch request for people aborted after 5 tries");
    expect(post).toHaveBeenCalledTimes(1);

    nowMs += 301_000; // just past the 300s window
    await logError("WhatsApp", "JORFSearch request for people aborted after 5 tries");
    expect(post).toHaveBeenCalledTimes(2);

    const secondText = (post.mock.calls[1][1] as { text: string }).text;
    expect(secondText).toContain("2 similar suppressed");
  });

  it("does not suppress alerts with distinct signatures", async () => {
    await logError("WhatsApp", "First distinct alert alpha");
    await logError("WhatsApp", "Second distinct alert beta");
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("respects the DEBUG_ALERT_DEDUP_WINDOW_SECONDS override", async () => {
    process.env.DEBUG_ALERT_DEDUP_WINDOW_SECONDS = "60";
    await logError("WhatsApp", "override window test gamma");
    nowMs += 61_000; // past the 60s override window
    await logError("WhatsApp", "override window test gamma");
    expect(post).toHaveBeenCalledTimes(2);
  });
});
