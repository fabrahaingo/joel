import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { postSpy, logErrorSpy, deleteSpy, userState, findOrCreateSpy } =
  vi.hoisted(() => ({
    postSpy: vi.fn(() => Promise.resolve({ data: {} })),
    logErrorSpy: vi.fn(() => Promise.resolve()),
    deleteSpy: vi.fn(() => Promise.resolve()),
    userState: { current: null, blocked: [] as { chatId: string }[] },
    findOrCreateSpy: vi.fn(() => Promise.resolve({ _id: "u1" }))
  }));

vi.mock("axios", async (orig) => {
  const actual = await orig<typeof import("axios")>();
  return {
    ...actual,
    default: { ...actual.default, post: postSpy },
    isAxiosError: actual.isAxiosError
  };
});
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn() }
}));
vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));
vi.mock("../utils/userDeletion.utils.ts", () => ({
  deleteUserAndCleanup: deleteSpy
}));
vi.mock("../models/User.ts", () => ({
  default: {
    find: vi.fn(() => ({
      select: () => ({ lean: () => Promise.resolve(userState.blocked) })
    })),
    findOne: vi.fn(() => ({ lean: () => Promise.resolve(userState.current) })),
    updateOne: vi.fn(() => Promise.resolve({})),
    findOrCreate: findOrCreateSpy
  }
}));

import {
  sendTelegramMessage,
  extractTelegramSession,
  refreshTelegramBlockedUsers,
  TelegramSession,
  TELEGRAM_MESSAGE_CHAR_LIMIT
} from "../entities/TelegramSession.ts";
import User from "../models/User.ts";
import type { ISession } from "../types.ts";
import type { Telegram } from "telegraf";
import { AxiosError } from "axios";

// An object that the real axios.isAxiosError() accepts (isAxiosError === true).
const axiosErr = (description?: string, code?: string) => {
  const e = new AxiosError("boom", code);
  if (description !== undefined) {
    // @ts-expect-error minimal response shape for the handler
    e.response = { data: { description } };
  }
  return e;
};

const baseOpt = { useAsyncUmamiLog: false, hasAccount: true };

beforeEach(() => {
  userState.current = null;
  userState.blocked = [];
  postSpy.mockResolvedValue({ data: {} });
  vi.stubGlobal("setTimeout", (fn: () => void) => {
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("sendTelegramMessage — happy path", () => {
  it("sends a single chunk and records delivery", async () => {
    const res = await sendTelegramMessage("TOK", "123", "hello", baseOpt);
    expect(res).toBe(true);
    expect(postSpy).toHaveBeenCalledTimes(1);
    const url = postSpy.mock.calls[0][0] as string;
    expect(url).toContain("/botTOK/sendMessage");
  });

  it("splits long messages and only attaches the keyboard to the last chunk", async () => {
    const long = "x".repeat(TELEGRAM_MESSAGE_CHAR_LIMIT * 2 + 50);
    const keyboard = [[{ text: "Menu" }]];
    const res = await sendTelegramMessage("TOK", "123", long, {
      ...baseOpt,
      keyboard
    });
    expect(res).toBe(true);
    expect(postSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    const payloads = postSpy.mock.calls.map(
      (c) => c[1] as Record<string, unknown>
    );
    const withKb = payloads.filter((p) => "reply_markup" in p);
    expect(withKb).toHaveLength(1);
    expect(payloads[payloads.length - 1]).toHaveProperty("reply_markup");
  });
});

describe("sendTelegramMessage — error handling", () => {
  it("marks an active user blocked when the bot was blocked", async () => {
    userState.current = { status: "active" };
    postSpy.mockRejectedValueOnce(
      axiosErr("Forbidden: bot was blocked by the user")
    );
    const res = await sendTelegramMessage("TOK", "123", "hi", baseOpt);
    expect(res).toBe(false);
    expect(User.updateOne).toHaveBeenCalledWith(
      { messageApp: "Telegram", chatId: "123" },
      { $set: { status: "blocked" } }
    );
  });

  it("deletes a deactivated user", async () => {
    postSpy.mockRejectedValueOnce(axiosErr("Forbidden: user is deactivated"));
    const res = await sendTelegramMessage("TOK", "123", "hi", baseOpt);
    expect(res).toBe(false);
    expect(deleteSpy).toHaveBeenCalledWith("Telegram", "123");
  });

  it("retries on 'Too Many Requests' then aborts after the retry budget", async () => {
    postSpy.mockRejectedValue(axiosErr("Too Many Requests: retry later"));
    const res = await sendTelegramMessage("TOK", "123", "hi", baseOpt);
    expect(res).toBe(false);
    // initial + retries (MAX_MESSAGE_RETRY=5, aborts once retryNumber > 5)
    expect(postSpy.mock.calls.length).toBeGreaterThan(5);
  });

  it("retries on a network-retryable code then aborts", async () => {
    postSpy.mockRejectedValue(axiosErr(undefined, "ECONNRESET"));
    const res = await sendTelegramMessage("TOK", "123", "hi", baseOpt);
    expect(res).toBe(false);
    expect(postSpy.mock.calls.length).toBeGreaterThan(5);
  });

  it("returns false on an unrecognised error without retrying", async () => {
    postSpy.mockRejectedValueOnce(new Error("nope"));
    const res = await sendTelegramMessage("TOK", "123", "hi", baseOpt);
    expect(res).toBe(false);
  });
});

describe("extractTelegramSession", () => {
  const tg = {} as unknown as Telegram;
  const fakeSession = (over: Partial<ISession> = {}): ISession =>
    ({
      messageApp: "Telegram",
      chatId: "1",
      language_code: "fr",
      user: null,
      isReply: false,
      lastEngagementAt: new Date(),
      loadUser: () => Promise.resolve(null),
      createUser: () => Promise.resolve(),
      sendMessage: vi.fn(() => Promise.resolve(true)),
      sendTypingAction: () => undefined,
      log: () => undefined,
      extractMessageAppsOptions: () => ({}),
      ...over
    }) as unknown as ISession;

  it("returns the session for a real TelegramSession", async () => {
    const s = new TelegramSession("TOK", tg, "123", "fr", new Date());
    expect(await extractTelegramSession(s)).toBe(s);
  });

  it("returns undefined for a non-Telegram session", async () => {
    const s = fakeSession({ messageApp: "Signal" });
    expect(await extractTelegramSession(s)).toBeUndefined();
  });

  it("sends the unavailable notice when userFacingError is set", async () => {
    const s = fakeSession({ messageApp: "Signal" });
    await extractTelegramSession(s, true);
    expect(s.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when app is Telegram but not a TelegramSession instance", async () => {
    const s = fakeSession({ messageApp: "Telegram" });
    expect(await extractTelegramSession(s)).toBeUndefined();
  });
});

describe("refreshTelegramBlockedUsers", () => {
  it("returns immediately when the bot token is undefined", async () => {
    await refreshTelegramBlockedUsers(undefined);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("returns when there are no blocked users", async () => {
    userState.blocked = [];
    await refreshTelegramBlockedUsers("TOK");
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("pings each blocked user and unblocks those that respond", async () => {
    userState.blocked = [{ chatId: "111" }, { chatId: "222" }];
    await refreshTelegramBlockedUsers("TOK");
    // One sendChatAction per blocked user.
    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(vi.mocked(User.updateOne)).toHaveBeenCalledWith(
      { messageApp: "Telegram", chatId: "111" },
      { $set: { status: "active" } }
    );
  });

  it("retries a rate-limited typing ping through the handler then gives up", async () => {
    userState.blocked = [{ chatId: "333" }];
    // Retryable error -> handler invokes the typing-action retry function.
    postSpy.mockRejectedValue(axiosErr("Too Many Requests: retry later"));
    await expect(refreshTelegramBlockedUsers("TOK")).resolves.toBeUndefined();
    expect(postSpy.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("TelegramSession — instance methods", () => {
  const tg = {} as unknown as Telegram;
  const make = () => new TelegramSession("TOK", tg, "123", "fr", new Date());

  it("loadUser delegates to the shared loader", async () => {
    expect(await make().loadUser()).toBeNull();
  });

  it("createUser sets the user from findOrCreate", async () => {
    const s = make();
    await s.createUser();
    expect(findOrCreateSpy).toHaveBeenCalledWith(s);
  });

  it("sendTypingAction does not throw", () => {
    expect(() => {
      make().sendTypingAction();
    }).not.toThrow();
  });

  it("log forwards to umami without throwing", () => {
    expect(() => {
      make().log({ event: "/message-sent" });
    }).not.toThrow();
  });

  it("sendMessage forwards to sendTelegramMessage", async () => {
    const res = await make().sendMessage("hi", { forceNoKeyboard: true });
    expect(res).toBe(true);
    expect(postSpy).toHaveBeenCalled();
  });

  it("extractMessageAppsOptions returns the bot token", () => {
    expect(make().extractMessageAppsOptions()).toEqual({
      telegramBotToken: "TOK"
    });
  });
});
