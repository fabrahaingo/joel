import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.WHATSAPP_PHONE_ID = "TEST_PHONE_ID";
});

const { logErrorSpy, deleteSpy, userState, findOrCreateSpy } = vi.hoisted(
  () => ({
    logErrorSpy: vi.fn(() => Promise.resolve()),
    deleteSpy: vi.fn(() => Promise.resolve()),
    userState: { current: null },
    findOrCreateSpy: vi.fn(() => Promise.resolve({ _id: "u1" }))
  })
);

vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn() }
}));
vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));
vi.mock("../utils/userDeletion.utils.ts", () => ({
  deleteUserAndCleanup: deleteSpy
}));
vi.mock("../models/User.ts", () => ({
  default: {
    find: vi.fn(() => Promise.resolve([])),
    findOne: vi.fn(() => ({ lean: () => Promise.resolve(userState.current) })),
    updateOne: vi.fn(() => Promise.resolve({})),
    findOrCreate: findOrCreateSpy
  }
}));

import {
  handleWhatsAppAPIErrors,
  sendWhatsAppTemplate,
  sendWhatsAppMessage,
  extractWhatsAppSession,
  WhatsAppSession,
  TEMPLATE_MESSAGE_COST_EUROS
} from "../entities/WhatsAppSession.ts";
import {
  messageReceivedTimeHistory,
  type ExtendedMiniUserInfo
} from "../entities/Session.ts";
import User from "../models/User.ts";
import type { ISession } from "../types.ts";
import type { WhatsAppAPI } from "whatsapp-api-js/middleware/express";

const HOUR = 60 * 60 * 1000;
const waUser = (
  over: Partial<ExtendedMiniUserInfo> = {}
): ExtendedMiniUserInfo => ({
  messageApp: "WhatsApp",
  chatId: "wa-" + Math.random().toString(36).slice(2),
  status: "active",
  hasAccount: true,
  waitingReengagement: false,
  lastEngagementAt: new Date(Date.now() - HOUR),
  ...over
});

beforeEach(() => {
  userState.current = null;
  vi.stubGlobal("setTimeout", (fn: () => void) => {
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("handleWhatsAppAPIErrors — terminal user-state codes", () => {
  it("blocks an active user on 131008", async () => {
    userState.current = { status: "active" };
    const res = await handleWhatsAppAPIErrors(
      { errorCode: 131008 },
      "test",
      "chat-1",
      vi.fn()
    );
    expect(res).toBe(false);
    expect(vi.mocked(User.updateOne)).toHaveBeenCalledWith(
      { messageApp: "WhatsApp", chatId: "chat-1" },
      { $set: { status: "blocked" } }
    );
  });

  it("deletes a user that is not on WhatsApp (131026)", async () => {
    const res = await handleWhatsAppAPIErrors(
      { errorCode: 131026 },
      "test",
      "chat-2",
      vi.fn()
    );
    expect(res).toBe(false);
    expect(deleteSpy).toHaveBeenCalledWith("WhatsApp", "chat-2");
  });

  it("restores lastMessageReceivedAt on reengagement-expired (131047)", async () => {
    const prev = new Date(Date.now() - 3 * HOUR);
    messageReceivedTimeHistory.set("WhatsApp:chat-3", prev);
    userState.current = {
      lastMessageReceivedAt: new Date(),
      lastEngagementAt: new Date(Date.now() - 25 * HOUR)
    };
    const res = await handleWhatsAppAPIErrors(
      { errorCode: 131047 },
      "test",
      "chat-3",
      vi.fn()
    );
    expect(res).toBe(false);
    expect(vi.mocked(User.updateOne)).toHaveBeenCalledWith(
      { messageApp: "WhatsApp", chatId: "chat-3" },
      { $set: { lastMessageReceivedAt: prev } }
    );
  });

  it("logs and returns false on 131047 when the user is missing", async () => {
    userState.current = null;
    const res = await handleWhatsAppAPIErrors(
      { errorCode: 131047 },
      "test",
      "chat-no-user",
      vi.fn()
    );
    expect(res).toBe(false);
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it("logs and returns false on 131047 when no receive-time snapshot exists", async () => {
    messageReceivedTimeHistory.delete("WhatsApp:chat-no-hist");
    userState.current = {
      lastMessageReceivedAt: new Date(),
      lastEngagementAt: new Date(Date.now() - 25 * HOUR)
    };
    const res = await handleWhatsAppAPIErrors(
      { errorCode: 131047 },
      "test",
      "chat-no-hist",
      vi.fn()
    );
    expect(res).toBe(false);
  });
});

describe("handleWhatsAppAPIErrors — transient codes", () => {
  it("retries then aborts after the retry budget", async () => {
    const retryFunction = vi.fn((n: number) =>
      handleWhatsAppAPIErrors(
        { errorCode: 131056 },
        "test",
        "chat-4",
        vi.fn(),
        {
          retryFunction,
          retryNumber: n
        }
      )
    );
    const res = await handleWhatsAppAPIErrors(
      { errorCode: 131056 },
      "test",
      "chat-4",
      vi.fn(),
      { retryFunction, retryNumber: 0 }
    );
    expect(res).toBe(false);
    expect(retryFunction).toHaveBeenCalled();
  });

  it("returns false on a transient code with no retry params", async () => {
    const res = await handleWhatsAppAPIErrors(
      { errorCode: 2 },
      "test",
      "chat-5",
      vi.fn()
    );
    expect(res).toBe(false);
  });

  it("returns false on an unrecognised code", async () => {
    const res = await handleWhatsAppAPIErrors(
      { errorCode: 999999 },
      "test",
      "chat-6",
      vi.fn()
    );
    expect(res).toBe(false);
  });
});

describe("sendWhatsAppTemplate", () => {
  it("records the cost and bumps the reminder count on success", async () => {
    const sendMessage = vi.fn(() =>
      Promise.resolve({ messages: [{ id: "x" }] })
    );
    const api = { sendMessage } as unknown as WhatsAppAPI;
    const res = await sendWhatsAppTemplate(
      api,
      waUser({
        chatId: "tpl-1",
        lastEngagementAt: new Date(Date.now() - 30 * HOUR)
      }),
      "people",
      { useAsyncUmamiLog: false, hasAccount: true }
    );
    expect(res).toBe(true);
    const costMatch: unknown = expect.objectContaining({
      cost: TEMPLATE_MESSAGE_COST_EUROS
    });
    expect(vi.mocked(User.updateOne)).toHaveBeenLastCalledWith(
      { messageApp: "WhatsApp", chatId: "tpl-1" },
      expect.objectContaining({
        $push: { costHistory: costMatch },
        $inc: { reengagementReminderCount: 1 }
      })
    );
  });

  it("routes a template send error through the retrying error handler", async () => {
    // Transient code -> the handler invokes the template retry function.
    const sendMessage = vi.fn(() =>
      Promise.resolve({ error: { code: 131056 } })
    );
    const api = { sendMessage } as unknown as WhatsAppAPI;
    const res = await sendWhatsAppTemplate(
      api,
      waUser({ lastEngagementAt: new Date(Date.now() - 30 * HOUR) }),
      "people",
      { useAsyncUmamiLog: false, hasAccount: true }
    );
    expect(res).toBe(false);
    // initial + retries (capped by MAX_MESSAGE_RETRY)
    expect(sendMessage.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("sendWhatsAppMessage — keyboard validation", () => {
  it("aborts when the keyboard has more than 3 buttons", async () => {
    const sendMessage = vi.fn();
    const api = { sendMessage } as unknown as WhatsAppAPI;
    const keyboard = [
      [{ text: "a" }, { text: "b" }],
      [{ text: "c" }, { text: "d" }]
    ];
    const res = await sendWhatsAppMessage(api, waUser(), "hi", {
      useAsyncUmamiLog: false,
      hasAccount: true,
      keyboard
    });
    expect(res).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("aborts when a keyboard button label exceeds 20 chars", async () => {
    const sendMessage = vi.fn();
    const api = { sendMessage } as unknown as WhatsAppAPI;
    const keyboard = [[{ text: "x".repeat(21) }]];
    const res = await sendWhatsAppMessage(api, waUser(), "hi", {
      useAsyncUmamiLog: false,
      hasAccount: true,
      keyboard
    });
    expect(res).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("extractWhatsAppSession", () => {
  const fakeSession = (over: Partial<ISession> = {}): ISession =>
    ({
      messageApp: "WhatsApp",
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

  it("returns a real WhatsAppSession", async () => {
    const api = {} as unknown as WhatsAppAPI;
    const s = new WhatsAppSession(api, "BOT", "33600000000", "fr", new Date());
    expect(await extractWhatsAppSession(s)).toBe(s);
  });

  it("returns undefined for a non-WhatsApp session", async () => {
    expect(
      await extractWhatsAppSession(fakeSession({ messageApp: "Signal" }))
    ).toBeUndefined();
  });

  it("returns undefined when app is WhatsApp but not a WhatsAppSession instance", async () => {
    expect(
      await extractWhatsAppSession(fakeSession({ messageApp: "WhatsApp" }))
    ).toBeUndefined();
  });

  it("sends the unavailable notice when userFacingError is set", async () => {
    const s = fakeSession({ messageApp: "Signal" });
    await extractWhatsAppSession(s, true);
    expect(s.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe("sendWhatsAppMessage — message variants", () => {
  const okResp = { messages: [{ id: "x" }] };

  it("sends with the default full menu when no keyboard is given", async () => {
    const sendMessage = vi.fn(() => Promise.resolve(okResp));
    const api = { sendMessage } as unknown as WhatsAppAPI;
    const res = await sendWhatsAppMessage(api, waUser(), "hello", {
      useAsyncUmamiLog: false,
      hasAccount: true
    });
    expect(res).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("builds reply buttons for a small keyboard", async () => {
    const sendMessage = vi.fn(() => Promise.resolve(okResp));
    const api = { sendMessage } as unknown as WhatsAppAPI;
    const res = await sendWhatsAppMessage(api, waUser(), "hello", {
      useAsyncUmamiLog: false,
      hasAccount: true,
      keyboard: [[{ text: "Oui" }, { text: "Non" }]]
    });
    expect(res).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("sends a separate menu message after the content", async () => {
    const sendMessage = vi.fn(() => Promise.resolve(okResp));
    const api = { sendMessage } as unknown as WhatsAppAPI;
    const res = await sendWhatsAppMessage(api, waUser(), "hello", {
      useAsyncUmamiLog: false,
      hasAccount: true,
      separateMenuMessage: true
    });
    expect(res).toBe(true);
    // content chunk + separate menu message
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("uses the full cooldown (non-burst) for messages over the burst threshold", async () => {
    const sendMessage = vi.fn(() => Promise.resolve(okResp));
    const api = { sendMessage } as unknown as WhatsAppAPI;
    // >180 short lines -> >10 chunks (18-line cap) -> non-burst path.
    const body = Array.from(
      { length: 240 },
      (_, n) => `line ${String(n)}`
    ).join("\n");
    const res = await sendWhatsAppMessage(api, waUser(), body, {
      useAsyncUmamiLog: false,
      hasAccount: true,
      forceNoKeyboard: true
    });
    expect(res).toBe(true);
    expect(sendMessage.mock.calls.length).toBeGreaterThan(10);
  });

  it("resumes the separate menu send via the retry path after a transient error", async () => {
    let n = 0;
    const sendMessage = vi.fn(() => {
      n++;
      // content chunk ok (1), menu transient-fails (2), menu retry ok (3)
      return Promise.resolve(n === 2 ? { error: { code: 131056 } } : okResp);
    });
    const api = { sendMessage } as unknown as WhatsAppAPI;
    const res = await sendWhatsAppMessage(api, waUser(), "hello", {
      useAsyncUmamiLog: false,
      hasAccount: true,
      separateMenuMessage: true
    });
    expect(res).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });
});

describe("sendWhatsAppTemplate — extra branches", () => {
  it("logs when sending a template to a still-in-window user", async () => {
    const sendMessage = vi.fn(() =>
      Promise.resolve({ messages: [{ id: "x" }] })
    );
    const api = { sendMessage } as unknown as WhatsAppAPI;
    // In-window (1h ago) -> the "non reengagement user" warning path.
    const res = await sendWhatsAppTemplate(
      api,
      waUser({ chatId: "inw" }),
      "people",
      {
        useAsyncUmamiLog: false,
        hasAccount: true
      }
    );
    expect(res).toBe(true);
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it("returns false when the template send throws", async () => {
    const sendMessage = vi.fn(() => Promise.reject(new Error("network")));
    const api = { sendMessage } as unknown as WhatsAppAPI;
    const res = await sendWhatsAppTemplate(
      api,
      waUser({ lastEngagementAt: new Date(Date.now() - 30 * HOUR) }),
      "people",
      { useAsyncUmamiLog: false, hasAccount: true }
    );
    expect(res).toBe(false);
  });
});

describe("WhatsAppSession — instance methods", () => {
  const make = () => {
    const sendMessage = vi.fn(() =>
      Promise.resolve({ messages: [{ id: "x" }] })
    );
    const api = { sendMessage } as unknown as WhatsAppAPI;
    const session = new WhatsAppSession(
      api,
      "BOT",
      "33600000000",
      "fr",
      new Date()
    );
    return { session, sendMessage };
  };

  it("loadUser delegates to the shared loader", async () => {
    expect(await make().session.loadUser()).toBeNull();
  });

  it("createUser sets the user from findOrCreate", async () => {
    const { session } = make();
    await session.createUser();
    expect(findOrCreateSpy).toHaveBeenCalledWith(session);
  });

  it("sendTypingAction and log do not throw", () => {
    const { session } = make();
    expect(() => {
      session.sendTypingAction();
    }).not.toThrow();
    expect(() => {
      session.log({ event: "/message-sent" });
    }).not.toThrow();
  });

  it("sendMessage forwards to sendWhatsAppMessage", async () => {
    const { session, sendMessage } = make();
    const res = await session.sendMessage("hi", { forceNoKeyboard: true });
    expect(res).toBe(true);
    expect(sendMessage).toHaveBeenCalled();
  });

  it("extractMessageAppsOptions returns the whatsAppAPI", () => {
    const { session } = make();
    expect(session.extractMessageAppsOptions()).toHaveProperty("whatsAppAPI");
  });
});
