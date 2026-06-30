import { describe, it, expect, vi, beforeEach } from "vitest";

// Per-app send functions are the dispatch targets. Replace each with a spy so we
// can assert routing without invoking the real SDK send paths.
const { tgSpy, whSpy, sgSpy, mxSpy } = vi.hoisted(() => ({
  tgSpy: vi.fn(() => Promise.resolve(true)),
  whSpy: vi.fn(() => Promise.resolve(true)),
  sgSpy: vi.fn(() => Promise.resolve(true)),
  mxSpy: vi.fn(() => Promise.resolve(true))
}));

vi.mock("../entities/TelegramSession.ts", () => ({
  sendTelegramMessage: tgSpy
}));
vi.mock("../entities/WhatsAppSession.ts", () => ({
  sendWhatsAppMessage: whSpy
}));
vi.mock("../entities/SignalSession.ts", () => ({
  sendSignalAppMessage: sgSpy
}));
vi.mock("../entities/MatrixSession.ts", () => ({
  sendMatrixMessage: mxSpy
}));
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn() }
}));
vi.mock("../utils/debugLogger.ts", () => ({
  logError: vi.fn(() => Promise.resolve())
}));
vi.mock("../models/User.ts", () => ({
  default: {
    find: vi.fn(() => Promise.resolve([])),
    findOne: vi.fn(() => ({ lean: () => Promise.resolve(null) })),
    updateOne: vi.fn(() => Promise.resolve({}))
  },
  USER_SCHEMA_VERSION: 3
}));

import { sendMessage } from "../entities/Session.ts";
import type { MessageApp } from "../types.ts";
import type { MatrixClient } from "matrix-bot-sdk";
import type { SignalCli } from "signal-sdk";
import type { WhatsAppAPI } from "whatsapp-api-js/middleware/express";

const opt = (over: Record<string, unknown> = {}) =>
  ({ useAsyncUmamiLog: false, hasAccount: true, ...over }) as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Session.sendMessage — dispatch routing", () => {
  it("routes Telegram to sendTelegramMessage with token + chatId", async () => {
    const res = await sendMessage(
      { messageApp: "Telegram", chatId: "42" },
      "hi",
      opt({ telegramBotToken: "TOKEN" })
    );
    expect(res).toBe(true);
    expect(tgSpy).toHaveBeenCalledTimes(1);
    expect(tgSpy.mock.calls[0][0]).toBe("TOKEN");
    expect(tgSpy.mock.calls[0][1]).toBe("42");
    expect(whSpy).not.toHaveBeenCalled();
  });

  it("routes Signal to sendSignalAppMessage", async () => {
    const signalCli = {} as unknown as SignalCli;
    await sendMessage(
      { messageApp: "Signal", chatId: "33600000000" },
      "hi",
      opt({ signalCli })
    );
    expect(sgSpy).toHaveBeenCalledTimes(1);
    expect(sgSpy.mock.calls[0][1]).toBe("33600000000");
  });

  it("routes Matrix and Tchap to sendMatrixMessage with the right client", async () => {
    const matrixClient = { tag: "m" } as unknown as MatrixClient;
    const tchapClient = { tag: "t" } as unknown as MatrixClient;
    await sendMessage(
      { messageApp: "Matrix", chatId: "@u:hs" },
      "hi",
      opt({ matrixClient })
    );
    await sendMessage(
      { messageApp: "Tchap", chatId: "@u:tchap" },
      "hi",
      opt({ tchapClient })
    );
    expect(mxSpy).toHaveBeenCalledTimes(2);
    expect(mxSpy.mock.calls[0][0]).toMatchObject({ messageApp: "Matrix" });
    expect(mxSpy.mock.calls[1][0]).toMatchObject({ messageApp: "Tchap" });
  });

  it("routes WhatsApp to sendWhatsAppMessage when lastEngagementAt is set", async () => {
    const whatsAppAPI = {} as unknown as WhatsAppAPI;
    await sendMessage(
      {
        messageApp: "WhatsApp",
        chatId: "33600000000",
        lastEngagementAt: new Date()
      },
      "hi",
      opt({ whatsAppAPI })
    );
    expect(whSpy).toHaveBeenCalledTimes(1);
  });
});

describe("Session.sendMessage — required-client guards", () => {
  it.each([
    ["Matrix", "matrixClient is required"],
    ["Tchap", "tchapClient is required"],
    ["Signal", "signalCli is required"],
    ["Telegram", "telegramBotToken is required"],
    ["WhatsApp", "WhatsAppAPI is required"]
  ] as [MessageApp, string][])(
    "throws when %s client is missing",
    async (app, msg) => {
      await expect(
        sendMessage({ messageApp: app, chatId: "1" }, "hi", opt())
      ).rejects.toThrow(msg);
    }
  );

  it("throws when WhatsApp lastEngagementAt is missing", async () => {
    const whatsAppAPI = {} as unknown as WhatsAppAPI;
    await expect(
      sendMessage(
        { messageApp: "WhatsApp", chatId: "1" },
        "hi",
        opt({ whatsAppAPI })
      )
    ).rejects.toThrow("lastEngagementAt is required");
  });

  it("throws on an unknown messageApp", async () => {
    await expect(
      sendMessage({ messageApp: "debug", chatId: "1" }, "hi", opt())
    ).rejects.toThrow("Unknown messageApp");
  });
});
