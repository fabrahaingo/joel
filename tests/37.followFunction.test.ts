import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const { logErrorSpy } = vi.hoisted(() => ({
  logErrorSpy: vi.fn(() => Promise.resolve())
}));
vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn(() => Promise.resolve()) }
}));

import User, { USER_SCHEMA_VERSION } from "../models/User.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import {
  followFunctionCommand,
  followFunctionFromStrCommand
} from "../commands/followFunction.ts";
import { handleFollowUpMessage } from "../entities/FollowUpManager.ts";
import type { ISession, IUser } from "../types.ts";

const sendSpy = vi.fn(() => Promise.resolve(true));
const makeSession = (user: IUser | null): ISession =>
  ({
    messageApp: "Telegram",
    chatId: "ff-" + Math.random().toString(36).slice(2),
    language_code: "fr",
    user,
    isReply: false,
    lastEngagementAt: new Date(),
    loadUser: () => Promise.resolve(user),
    createUser: () => Promise.resolve(),
    sendMessage: sendSpy,
    sendTypingAction: vi.fn(),
    log: vi.fn(),
    extractMessageAppsOptions: () => ({})
  }) as unknown as ISession;

const makeUserDoc = () =>
  User.create({
    chatId: "ffu-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION,
    status: "active"
  });

beforeEach(async () => {
  if (!mongoose.connection.db) throw new Error("no db");
  await mongoose.connection.db.dropDatabase();
  vi.clearAllMocks();
  sendSpy.mockResolvedValue(true);
});

describe("followFunctionCommand", () => {
  it("lists functions and marks already-followed ones", async () => {
    const user = await makeUserDoc();
    await user.addFollowedFunction(FunctionTags.Ambassadeur);
    await followFunctionCommand(makeSession(await User.findById(user._id)));
    const text = String(sendSpy.mock.calls[0][0]);
    expect(text).toContain("Ambassadeur");
    expect(text).toContain("Suivi");
  });

  it("logs on error", async () => {
    sendSpy.mockRejectedValueOnce(new Error("x"));
    await followFunctionCommand(makeSession(null));
    expect(logErrorSpy).toHaveBeenCalled();
  });
});

describe("followFunction follow-up answers", () => {
  it("follows a function selected by number", async () => {
    const user = await makeUserDoc();
    const session = makeSession(await User.findById(user._id));
    await followFunctionCommand(session);
    sendSpy.mockClear();
    const handled = await handleFollowUpMessage(session, "1");
    expect(handled).toBe(true);
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "suivez maintenant la fonction"
    );
  });

  it("re-asks on an empty answer", async () => {
    const session = makeSession(await makeUserDoc());
    await followFunctionCommand(session);
    sendSpy.mockClear();
    const handled = await handleFollowUpMessage(session, "   ");
    expect(handled).toBe(true);
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'a pas été reconnue");
  });

  it("defers a slash answer", async () => {
    const session = makeSession(await makeUserDoc());
    await followFunctionCommand(session);
    const handled = await handleFollowUpMessage(session, "/start");
    expect(handled).toBe(false);
  });

  it("re-asks on an unrecognised selection", async () => {
    const session = makeSession(await makeUserDoc());
    await followFunctionCommand(session);
    sendSpy.mockClear();
    const handled = await handleFollowUpMessage(session, "zzznotafunction");
    expect(handled).toBe(true);
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'est pas reconnue");
  });
});

describe("followFunctionFromStrCommand", () => {
  it("opens the picker when no selection is given", async () => {
    await followFunctionFromStrCommand(
      makeSession(await makeUserDoc()),
      "SuivreF"
    );
    expect(String(sendSpy.mock.calls[0][0])).toContain("liste des fonctions");
  });

  it("rejects an unrecognised function", async () => {
    await followFunctionFromStrCommand(
      makeSession(await makeUserDoc()),
      "SuivreF zzznope"
    );
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'est pas reconnue");
  });

  it("follows a single function selected by value name", async () => {
    const user = await makeUserDoc();
    const session = makeSession(await User.findById(user._id));
    await followFunctionFromStrCommand(session, "SuivreF ambassadeur");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "suivez maintenant la fonction"
    );
  });

  it("follows multiple functions and reports already-followed ones", async () => {
    const user = await makeUserDoc();
    await user.addFollowedFunction(FunctionTags.Ambassadeur);
    const session = makeSession(await User.findById(user._id));
    // "Ambassadeur" already followed, "2" newly followed -> mixed message
    await followFunctionFromStrCommand(session, "SuivreF Ambassadeur 2");
    const text = String(sendSpy.mock.calls.at(-1)?.[0]);
    expect(text).toContain("suivez déjà");
  });

  it("creates a user when none exists then follows", async () => {
    const session = makeSession(null);
    await followFunctionFromStrCommand(session, "SuivreF 1 2");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "suivez maintenant les fonctions"
    );
  });

  it("deduplicates a function selected twice (number + name)", async () => {
    const session = makeSession(await makeUserDoc());
    await followFunctionFromStrCommand(session, "SuivreF 1 ambassadeur");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "suivez maintenant la fonction"
    );
  });

  it("reports multiple added and multiple already-followed", async () => {
    const session = makeSession(await makeUserDoc());
    await followFunctionFromStrCommand(session, "SuivreF 1 2");
    sendSpy.mockClear();
    await followFunctionFromStrCommand(session, "SuivreF 1 2 3 4");
    const text = String(sendSpy.mock.calls.at(-1)?.[0]);
    expect(text).toContain("suivez maintenant les fonctions");
    expect(text).toContain("suivez déjà les fonctions");
  });

  it("logs on error", async () => {
    sendSpy.mockRejectedValueOnce(new Error("x"));
    await followFunctionFromStrCommand(makeSession(null), "SuivreF zzznope");
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it("logs when adding a follow throws", async () => {
    const session = makeSession({
      addFollowedFunction: vi.fn(() => Promise.reject(new Error("db down")))
    } as unknown as IUser);
    await followFunctionFromStrCommand(session, "SuivreF ambassadeur");
    expect(logErrorSpy).toHaveBeenCalledWith(
      "Telegram",
      expect.stringContaining("followFunctions"),
      expect.any(Error)
    );
  });
});
