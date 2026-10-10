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

import {
  sendWhatsAppMessage,
  WHATSAPP_REENGAGEMENT_MARGIN_MINS,
  WHATSAPP_SHIFT_STEP_MINS
} from "../entities/WhatsAppSession.ts";
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

    // 24h ago by wall clock -> past the 23h58m cutoff. No windowNow -> real time.
    const userInfo = waUser(new Date(Date.now() - 24 * HOUR_MS));

    // Must NOT throw: a thrown guard is uncaught through the dispatch Promise.all
    // and aborts the whole run. It must return false instead.
    const res = await sendWhatsAppMessage(api, userInfo, "hi", {
      hasAccount: true
    });

    expect(res).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("ignores a stale in-window windowNow: wall clock past the cutoff blocks the send (prevents async 131047)", async () => {
    const sendMessage = vi.fn();
    const api = { sendMessage } as unknown as WhatsAppAPI;

    // Wall clock: 23h59m ago -> past the 23h58m cutoff. Meta would reject this
    // send asynchronously with 131047, so the guard must block it.
    const lastEngagementAt = new Date(Date.now() - (24 * 60 - 1) * MIN_MS);
    // windowNow (run-start snapshot): 23h after engagement -> in window. A slow
    // run makes exactly this divergence; the snapshot must NOT win here.
    const windowNow = new Date(lastEngagementAt.getTime() + 23 * HOUR_MS);

    const res = await sendWhatsAppMessage(api, waUser(lastEngagementAt), "hi", {
      hasAccount: true,
      windowNow
    });

    expect(res).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends when wall clock is in window, even with an expired-looking windowNow snapshot", async () => {
    // Reject the actual API call so we stop right after the guard, before
    // cooldowns / DB writes — we only need to prove the guard let us through.
    const sendMessage = vi
      .fn()
      .mockRejectedValue(new Error("stop after guard"));
    const api = { sendMessage } as unknown as WhatsAppAPI;

    // Wall clock: 1h ago -> comfortably in window.
    const lastEngagementAt = new Date(Date.now() - HOUR_MS);
    // windowNow: 25h after engagement -> expired per snapshot, but real time rules.
    const windowNow = new Date(lastEngagementAt.getTime() + 25 * HOUR_MS);

    const res = await sendWhatsAppMessage(api, waUser(lastEngagementAt), "hi", {
      hasAccount: true,
      windowNow
    });

    // Guard passed (used wall clock, not the stale snapshot): the API was reached.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    // The injected API error is swallowed -> false, never thrown.
    expect(res).toBe(false);
  });

  it("sends to a user who engaged right after yesterday's run when today's shifted run is a minute late", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValue(new Error("stop after guard"));
    const api = { sendMessage } as unknown as WhatsAppAPI;

    // Engaged 20s after yesterday's send; today's run starts one shift step
    // earlier and reaches this user 60s after it started.
    const elapsedMs = 24 * HOUR_MS - WHATSAPP_SHIFT_STEP_MINS * MIN_MS + 80_000;
    const lastEngagementAt = new Date(Date.now() - elapsedMs);

    await sendWhatsAppMessage(api, waUser(lastEngagementAt), "hi", {
      hasAccount: true
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps the daily shift step above the cutoff margin", () => {
    expect(WHATSAPP_SHIFT_STEP_MINS).toBeGreaterThan(
      WHATSAPP_REENGAGEMENT_MARGIN_MINS
    );
  });
});
