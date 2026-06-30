import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// WhatsAppSession captures WHATSAPP_PHONE_ID at module load. This suite verifies
// the guard that throws when it is unset, so make sure it is absent before the
// import is hoisted (vi.hoisted runs first).
vi.hoisted(() => {
  delete process.env.WHATSAPP_PHONE_ID;
});

vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn() }
}));
vi.mock("../utils/debugLogger.ts", () => ({
  logError: vi.fn(() => Promise.resolve())
}));
vi.mock("../models/User.ts", () => ({
  default: {
    findOne: vi.fn(() => ({ lean: () => Promise.resolve(null) })),
    updateOne: vi.fn(() => Promise.resolve({}))
  }
}));

import {
  sendWhatsAppMessage,
  sendWhatsAppTemplate
} from "../entities/WhatsAppSession.ts";
import type { ExtendedMiniUserInfo } from "../entities/Session.ts";
import type { WhatsAppAPI } from "whatsapp-api-js/middleware/express";

const HOUR = 60 * 60 * 1000;
const waUser = (): ExtendedMiniUserInfo => ({
  messageApp: "WhatsApp",
  chatId: "nophone-" + Math.random().toString(36).slice(2),
  status: "active",
  hasAccount: true,
  waitingReengagement: false,
  lastEngagementAt: new Date(Date.now() - HOUR)
});

beforeEach(() => {
  vi.stubGlobal("setTimeout", (fn: () => void) => {
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WhatsApp send guards — WHATSAPP_PHONE_ID unset", () => {
  it("sendWhatsAppMessage throws a descriptive error", async () => {
    const api = { sendMessage: vi.fn() } as unknown as WhatsAppAPI;
    await expect(
      sendWhatsAppMessage(api, waUser(), "hi", {
        useAsyncUmamiLog: false,
        hasAccount: true
      })
    ).rejects.toThrow("WHATSAPP_PHONE_ID is not set");
  });

  it("sendWhatsAppTemplate throws a descriptive error", async () => {
    const api = { sendMessage: vi.fn() } as unknown as WhatsAppAPI;
    await expect(
      sendWhatsAppTemplate(
        api,
        { ...waUser(), lastEngagementAt: new Date(Date.now() - 30 * HOUR) },
        "people",
        { useAsyncUmamiLog: false, hasAccount: true }
      )
    ).rejects.toThrow("WHATSAPP_PHONE_ID is not set");
  });
});
