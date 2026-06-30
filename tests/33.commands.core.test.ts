import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

const { buildInfoSpy, deleteSpy, logErrorSpy } = vi.hoisted(() => ({
  buildInfoSpy: vi.fn(() =>
    Promise.resolve({
      uptime: "1h",
      commitHash: "abc1234",
      commitUrl: "https://github.com/x/y/commit/abc1234"
    })
  ),
  deleteSpy: vi.fn(() => Promise.resolve()),
  logErrorSpy: vi.fn(() => Promise.resolve())
}));

vi.mock("../utils/buildInfo.ts", () => ({ getBuildInfo: buildInfoSpy }));
vi.mock("../utils/userDeletion.utils.ts", () => ({
  deleteUserAndCleanup: deleteSpy
}));
vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn(() => Promise.resolve()) }
}));

import User, { USER_SCHEMA_VERSION } from "../models/User.ts";
import People from "../models/People.ts";
import Organisation from "../models/Organisation.ts";
import {
  defaultCommand,
  mainMenuCommand,
  sendMainMenu
} from "../commands/default.ts";
import {
  helpCommand,
  buildInfoCommand,
  getCommandsTexts,
  getHelpText
} from "../commands/help.ts";
import {
  statsCommand,
  getStatsText,
  resetStatsCache
} from "../commands/stats.ts";
import { deleteProfileCommand } from "../commands/deleteProfile.ts";
import { handleFollowUpMessage } from "../entities/FollowUpManager.ts";
import type { ISession, IUser, MessageApp } from "../types.ts";

const sendSpy = vi.fn(() => Promise.resolve(true));
const logSpy = vi.fn();

const makeSession = (over: Partial<ISession> = {}): ISession =>
  ({
    messageApp: "Telegram",
    chatId: "c-" + Math.random().toString(36).slice(2),
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

beforeEach(async () => {
  if (!mongoose.connection.db) throw new Error("no db");
  await mongoose.connection.db.dropDatabase();
  vi.clearAllMocks();
  sendSpy.mockResolvedValue(true);
  resetStatsCache();
});

describe("defaultCommand", () => {
  it("sends a fallback message", async () => {
    await defaultCommand(makeSession());
    expect(sendSpy).toHaveBeenCalled();
  });

  it("does nothing on a reply", async () => {
    await defaultCommand(makeSession({ isReply: true }));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("logs on error", async () => {
    sendSpy.mockRejectedValueOnce(new Error("x"));
    await defaultCommand(makeSession());
    expect(logErrorSpy).toHaveBeenCalled();
  });
});

describe("sendMainMenu", () => {
  it("uses the session when provided", async () => {
    const session = makeSession();
    await mainMenuCommand(session);
    expect(sendSpy).toHaveBeenCalled();
  });

  it("routes through the external sender when no session is given", async () => {
    // With empty externalOptions the real dispatch can't find a client and the
    // command swallows the error — the point is the external branch executes.
    await expect(
      sendMainMenu(
        {
          chatId: "1",
          messageApp: "Telegram",
          roomId: undefined,
          hasAccount: true
        },
        { externalOptions: {} }
      )
    ).resolves.toBeUndefined();
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it("throws when neither session nor externalOptions is provided", async () => {
    await expect(
      sendMainMenu(
        {
          chatId: "1",
          messageApp: "Telegram",
          roomId: undefined,
          hasAccount: true
        },
        {}
      )
    ).rejects.toThrow("session or externalOptions is required");
  });

  it.each(["Matrix", "Signal", "WhatsApp"] as MessageApp[])(
    "renders the menu for %s",
    async (app) => {
      await mainMenuCommand(makeSession({ messageApp: app }));
      expect(sendSpy).toHaveBeenCalled();
    }
  );
});

describe("help", () => {
  it("getCommandsTexts differs for Telegram vs others", () => {
    expect(getCommandsTexts("Telegram")).toContain("/export");
    expect(getCommandsTexts("WhatsApp")).toContain("Exporter");
  });

  it("getHelpText injects the follow channel per app", () => {
    expect(getHelpText(makeSession({ messageApp: "Telegram" }))).toBeTruthy();
    expect(getHelpText(makeSession({ messageApp: "WhatsApp" }))).toBeTruthy();
  });

  it("helpCommand sends the assembled help", async () => {
    await helpCommand(makeSession());
    expect(sendSpy).toHaveBeenCalled();
  });

  it("buildInfoCommand renders a commit link", async () => {
    await buildInfoCommand(makeSession());
    expect(sendSpy).toHaveBeenCalled();
    expect(String(sendSpy.mock.calls[0][0])).toContain("abc1234");
  });

  it("buildInfoCommand handles a missing commit hash", async () => {
    buildInfoSpy.mockResolvedValueOnce({
      uptime: "1h",
      commitHash: null,
      commitUrl: null
    });
    await buildInfoCommand(makeSession());
    expect(String(sendSpy.mock.calls[0][0])).toContain("inconnu");
  });

  it("buildInfoCommand handles a hash without a url", async () => {
    buildInfoSpy.mockResolvedValueOnce({
      uptime: "1h",
      commitHash: "def5678",
      commitUrl: null
    });
    await buildInfoCommand(makeSession());
    expect(String(sendSpy.mock.calls[0][0])).toContain("def5678");
  });
});

describe("stats", () => {
  const makeUser = (over = {}) =>
    User.create({
      chatId: "s-" + Math.random().toString(36).slice(2),
      messageApp: "Telegram",
      schemaVersion: USER_SCHEMA_VERSION,
      ...over
    });

  it("getStatsText reports populated counts", async () => {
    await makeUser({
      followedNames: ["A"],
      followedMeta: [{ alertString: "x", lastUpdate: new Date() }]
    });
    await People.create({ nom: "Dupont", prenom: "Jean" });
    await Organisation.create({ wikidataId: "Q1", nom: "Org" });
    const text = await getStatsText(makeSession());
    expect(text).toContain("utilisateurs");
    expect(text).toContain("personnes suivies");
  });

  it("statsCommand sends the stats", async () => {
    await makeUser();
    await statsCommand(makeSession());
    expect(sendSpy).toHaveBeenCalled();
  });

  it("getStatsText returns empty and logs on error", async () => {
    const spy = vi
      .spyOn(User, "aggregate")
      .mockRejectedValueOnce(new Error("db down"));
    const text = await getStatsText(makeSession());
    expect(text).toBe("");
    expect(logErrorSpy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("serves the cached snapshot on a second call", async () => {
    await makeUser();
    const session = makeSession();
    await getStatsText(session);
    const aggSpy = vi.spyOn(User, "aggregate");
    await getStatsText(session); // within TTL -> cache hit, no new aggregate
    expect(aggSpy).not.toHaveBeenCalled();
    aggSpy.mockRestore();
  });
});

describe("deleteProfile", () => {
  const userSession = () =>
    makeSession({
      user: {
        messageApp: "Telegram",
        chatId: "del-1"
      } as unknown as IUser
    });

  it("tells the user when no profile exists", async () => {
    await deleteProfileCommand(makeSession());
    expect(String(sendSpy.mock.calls[0][0])).toContain("Aucun profil");
  });

  it("asks for confirmation when a profile exists", async () => {
    await deleteProfileCommand(userSession());
    expect(String(sendSpy.mock.calls[0][0])).toContain(
      "supprimer votre profil"
    );
  });

  it("deletes the account on the exact confirmation phrase", async () => {
    const session = userSession();
    await deleteProfileCommand(session);
    sendSpy.mockClear();
    const handled = await handleFollowUpMessage(
      session,
      "SUPPRIMER MON COMPTE"
    );
    expect(handled).toBe(true);
    expect(deleteSpy).toHaveBeenCalled();
    expect(session.user).toBeNull();
  });

  it("cancels on a non-matching answer", async () => {
    const session = userSession();
    await deleteProfileCommand(session);
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "non");
    expect(String(sendSpy.mock.calls[0][0])).toContain("annulée");
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("rejects an empty answer", async () => {
    const session = userSession();
    await deleteProfileCommand(session);
    sendSpy.mockClear();
    const handled = await handleFollowUpMessage(session, "   ");
    expect(handled).toBe(true);
    expect(String(sendSpy.mock.calls[0][0])).toContain("pas été reconnue");
  });

  it("defers a slash-command answer back to normal routing", async () => {
    const session = userSession();
    await deleteProfileCommand(session);
    const handled = await handleFollowUpMessage(session, "/start");
    expect(handled).toBe(false);
  });

  it("handles a confirmation when the profile vanished mid-flow", async () => {
    const session = userSession();
    await deleteProfileCommand(session);
    session.user = null;
    sendSpy.mockClear();
    const handled = await handleFollowUpMessage(
      session,
      "SUPPRIMER MON COMPTE"
    );
    expect(handled).toBe(true);
    expect(String(sendSpy.mock.calls[0][0])).toContain("Aucun profil");
  });

  it("logs when asking for confirmation fails", async () => {
    const session = userSession();
    sendSpy.mockRejectedValueOnce(new Error("send down"));
    await deleteProfileCommand(session);
    expect(logErrorSpy).toHaveBeenCalled();
  });
});
