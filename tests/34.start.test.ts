import { describe, it, expect, vi, beforeEach } from "vitest";

const { processMsgSpy, logErrorSpy } = vi.hoisted(() => ({
  processMsgSpy: vi.fn(() => Promise.resolve()),
  logErrorSpy: vi.fn(() => Promise.resolve())
}));

vi.mock("../commands/Commands.ts", () => ({ processMessage: processMsgSpy }));
vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn(() => Promise.resolve()) }
}));

import { startCommand } from "../commands/start.ts";
import type { ISession } from "../types.ts";

const sendSpy = vi.fn(() => Promise.resolve(true));
const logSpy = vi.fn();

const makeSession = (over: Partial<ISession> = {}): ISession =>
  ({
    messageApp: "Telegram",
    chatId: "st-" + Math.random().toString(36).slice(2),
    language_code: "fr",
    user: null,
    isReply: false,
    lastEngagementAt: new Date(),
    loadUser: () => Promise.resolve(null),
    createUser: () => Promise.resolve(),
    sendMessage: sendSpy,
    sendTypingAction: vi.fn(),
    log: logSpy,
    extractMessageAppsOptions: () => ({}),
    ...over
  }) as unknown as ISession;

beforeEach(() => {
  vi.clearAllMocks();
  sendSpy.mockResolvedValue(true);
});

describe("startCommand", () => {
  it("sends help on a classic /start", async () => {
    await startCommand(makeSession(), "/start");
    expect(sendSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith({ event: "/start" });
    expect(processMsgSpy).not.toHaveBeenCalled();
  });

  it("routes an embedded people command", async () => {
    await startCommand(makeSession(), "/start Suivre Jean Dupont");
    expect(logSpy).toHaveBeenCalledWith({ event: "/start-from-people" });
    expect(processMsgSpy).toHaveBeenCalledWith(
      expect.anything(),
      "Suivre Jean Dupont"
    );
  });

  it("logs the organisation intent", async () => {
    await startCommand(makeSession(), "/start suivreo Q123");
    expect(logSpy).toHaveBeenCalledWith({ event: "/start-from-organisation" });
  });

  it("logs the tag intent", async () => {
    await startCommand(makeSession(), "/start suivref ambassadeur");
    expect(logSpy).toHaveBeenCalledWith({ event: "/start-from-tag" });
  });

  it("logs the search intent", async () => {
    await startCommand(makeSession(), "/start recherche Jean");
    expect(logSpy).toHaveBeenCalledWith({ event: "/start-from-people" });
  });

  it("handles the Bonjour greeting form", async () => {
    await startCommand(makeSession(), "Bonjour JOEL ! Suivre Jean");
    expect(processMsgSpy).toHaveBeenCalled();
  });

  it("logs on error", async () => {
    sendSpy.mockRejectedValueOnce(new Error("send down"));
    await startCommand(makeSession(), "/start");
    expect(logErrorSpy).toHaveBeenCalled();
  });
});
