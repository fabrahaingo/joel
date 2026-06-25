import { describe, it, expect, vi } from "vitest";

// WhatsAppSession reads WHATSAPP_PHONE_ID at module load, so set it before the
// import is hoisted (vi.hoisted runs first). Without it the post-guard send path
// would throw "WHATSAPP_PHONE_ID is not set" and we couldn't reach the API stub.
vi.hoisted(() => {
  process.env.WHATSAPP_PHONE_ID = "TEST_PHONE_ID";
});

// Keep umami/logError side-effects inert; the guard logs on the degrade path.
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn() }
}));

import { sendWhatsAppMessage } from "../entities/WhatsAppSession.ts";
import type { ExtendedMiniUserInfo } from "../entities/Session.ts";
import type { WhatsAppAPI } from "whatsapp-api-js/middleware/express";

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;

const waUser = (lastEngagementAt: Date): ExtendedMiniUserInfo => ({
  messageApp: "WhatsApp",
  chatId: "guard-" + Math.random().toString(36).slice(2),
  status: "active",
  hasAccount: true,
  waitingReengagement: false,
  lastEngagementAt
});

describe("sendWhatsAppMessage — re-engagement guard", () => {
  it("degrades (returns false, no throw, no API call) when expired and no windowNow", async () => {
    const sendMessage = vi.fn();
    const api = { sendMessage } as unknown as WhatsAppAPI;

    // 24h ago by wall clock -> past the 23h55m cutoff. No windowNow -> real time.
    const userInfo = waUser(new Date(Date.now() - 24 * HOUR_MS));

    // Must NOT throw: a thrown guard is uncaught through the dispatch Promise.all
    // and aborts the whole run. It must return false instead.
    const res = await sendWhatsAppMessage(api, userInfo, "hi", {
      hasAccount: true
    });

    expect(res).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("honors windowNow: a user in-window per windowNow still sends, even if wall-clock drifted past the cutoff", async () => {
    // Reject the actual API call so we stop right after the guard, before
    // cooldowns / DB writes — we only need to prove the guard let us through.
    const sendMessage = vi
      .fn()
      .mockRejectedValue(new Error("stop after guard"));
    const api = { sendMessage } as unknown as WhatsAppAPI;

    // Wall clock: 23h58m ago -> would be rejected by new Date() (past 23h55m).
    const lastEngagementAt = new Date(Date.now() - (24 * 60 - 2) * MIN_MS);
    // windowNow: 23h after engagement -> comfortably in window.
    const windowNow = new Date(lastEngagementAt.getTime() + 23 * HOUR_MS);

    const res = await sendWhatsAppMessage(api, waUser(lastEngagementAt), "hi", {
      hasAccount: true,
      windowNow
    });

    // Guard passed (used windowNow, not wall clock): the API was reached.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    // The injected API error is swallowed -> false, never thrown.
    expect(res).toBe(false);
  });
});
