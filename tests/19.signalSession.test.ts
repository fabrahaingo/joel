import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { logErrorSpy } = vi.hoisted(() => ({ logErrorSpy: vi.fn() }));

vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn() }
}));
vi.mock("../utils/debugLogger.ts", () => ({
  logError: logErrorSpy
}));
vi.mock("../models/User.ts", () => ({
  default: {
    findOne: vi.fn(() => ({ lean: () => Promise.resolve(null) })),
    updateOne: vi.fn(() => Promise.resolve({}))
  }
}));

import {
  SignalSession,
  extractSignalAppSession,
  sendSignalAppMessage
} from "../entities/SignalSession.ts";
import type { ISession } from "../types.ts";
import type { SignalCli } from "signal-sdk";

const makeSignalCli = () => {
  const sendMessage = vi.fn(() => Promise.resolve({}));
  return { cli: { sendMessage } as unknown as SignalCli, sendMessage };
};

const makeSession = (over: Partial<ISession> = {}): ISession =>
  ({
    messageApp: "Signal",
    chatId: "33600000000",
    language_code: "fr",
    user: null,
    isReply: false,
    lastEngagementAt: new Date(),
    loadUser: () => Promise.resolve(null),
    createUser: () => Promise.resolve(),
    sendMessage: () => Promise.resolve(true),
    sendTypingAction: () => undefined,
    log: () => undefined,
    extractMessageAppsOptions: () => ({}),
    ...over
  }) as unknown as ISession;

beforeEach(() => {
  vi.stubGlobal("setTimeout", (fn: () => void) => {
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("extractSignalAppSession", () => {
  it("returns the session when it is a SignalSession", async () => {
    const { cli } = makeSignalCli();
    const session = new SignalSession(
      cli,
      "BOT",
      "33600000000",
      "fr",
      new Date()
    );
    expect(await extractSignalAppSession(session)).toBe(session);
  });

  it("returns undefined and logs when messageApp is not Signal", async () => {
    const session = makeSession({ messageApp: "Telegram" });
    expect(await extractSignalAppSession(session)).toBeUndefined();
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it("sends the user-facing unavailable message when userFacingError is set", async () => {
    const sendMessage = vi.fn(() => Promise.resolve(true));
    const session = makeSession({ messageApp: "Telegram", sendMessage });
    await extractSignalAppSession(session, true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(String(sendMessage.mock.calls[0][0])).toContain("Telegram");
  });

  it("returns undefined when messageApp is Signal but not a SignalSession instance", async () => {
    const session = makeSession({ messageApp: "Signal" });
    expect(await extractSignalAppSession(session)).toBeUndefined();
    expect(logErrorSpy).toHaveBeenCalled();
  });
});

describe("sendSignalAppMessage — phone normalisation", () => {
  it("prefixes a bare phone number with +", async () => {
    const { cli, sendMessage } = makeSignalCli();
    const res = await sendSignalAppMessage(cli, "33600000000", "hi", {
      useAsyncUmamiLog: false,
      hasAccount: true
    });
    expect(res).toBe(true);
    expect(sendMessage.mock.calls[0][0]).toBe("+33600000000");
  });

  it("leaves an already-prefixed number untouched", async () => {
    const { cli, sendMessage } = makeSignalCli();
    await sendSignalAppMessage(cli, "+33600000000", "hi", {
      useAsyncUmamiLog: false,
      hasAccount: true
    });
    expect(sendMessage.mock.calls[0][0]).toBe("+33600000000");
  });
});

describe("SignalSession.sendMessage wrapper", () => {
  it("delegates to sendSignalAppMessage and reports hasAccount=false when no user", async () => {
    const { cli, sendMessage } = makeSignalCli();
    const session = new SignalSession(
      cli,
      "BOT",
      "33611111111",
      "fr",
      new Date()
    );
    const res = await session.sendMessage("hello");
    expect(res).toBe(true);
    expect(sendMessage.mock.calls[0][0]).toBe("+33611111111");
  });

  it("extractMessageAppsOptions returns the signalCli", () => {
    const { cli } = makeSignalCli();
    const session = new SignalSession(cli, "BOT", "1", "fr", new Date());
    expect(session.extractMessageAppsOptions()).toEqual({ signalCli: cli });
  });
});
