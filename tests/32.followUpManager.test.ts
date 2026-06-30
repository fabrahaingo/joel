import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  askFollowUpQuestion,
  handleFollowUpMessage,
  clearFollowUp,
  hasFollowUp
} from "../entities/FollowUpManager.ts";
import type { ISession } from "../types.ts";

const makeSession = (over: Partial<ISession> = {}): ISession =>
  ({
    messageApp: "Telegram",
    chatId: "fu-" + Math.random().toString(36).slice(2),
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FollowUpManager", () => {
  it("stores a follow-up and sends the question", async () => {
    const session = makeSession();
    const handler = vi.fn(() => Promise.resolve(true));
    await askFollowUpQuestion(session, "Question?", handler);
    expect(session.sendMessage).toHaveBeenCalledWith("Question?", undefined);
    expect(hasFollowUp(session)).toBe(true);
  });

  it("does not send when the question is empty but still registers the handler", async () => {
    const session = makeSession();
    const handler = vi.fn(() => Promise.resolve(true));
    const res = await askFollowUpQuestion(session, "", handler);
    expect(res).toBe(false);
    expect(session.sendMessage).not.toHaveBeenCalled();
    expect(hasFollowUp(session)).toBe(true);
  });

  it("removes the follow-up and rethrows when sending the question fails", async () => {
    const session = makeSession({
      sendMessage: vi.fn(() => Promise.reject(new Error("boom")))
    });
    const handler = vi.fn(() => Promise.resolve(true));
    await expect(askFollowUpQuestion(session, "Q?", handler)).rejects.toThrow(
      "boom"
    );
    expect(hasFollowUp(session)).toBe(false);
  });

  it("returns false from handleFollowUpMessage when nothing is registered", async () => {
    const session = makeSession();
    expect(await handleFollowUpMessage(session, "hi")).toBe(false);
  });

  it("invokes and clears the registered handler", async () => {
    const session = makeSession();
    const handler = vi.fn(() => Promise.resolve(true));
    await askFollowUpQuestion(session, "Q?", handler, { context: { x: 1 } });
    const res = await handleFollowUpMessage(session, "answer");
    expect(res).toBe(true);
    expect(handler).toHaveBeenCalledWith(session, "answer", { x: 1 });
    expect(hasFollowUp(session)).toBe(false);
  });

  it("clearFollowUp removes a pending follow-up", async () => {
    const session = makeSession();
    await askFollowUpQuestion(
      session,
      "Q?",
      vi.fn(() => Promise.resolve(true))
    );
    clearFollowUp(session);
    expect(hasFollowUp(session)).toBe(false);
  });
});
