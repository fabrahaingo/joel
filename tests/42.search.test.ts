import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const { logErrorSpy, callPeopleSpy, refAnswerSpy } = vi.hoisted(() => ({
  logErrorSpy: vi.fn(() => Promise.resolve()),
  callPeopleSpy: vi.fn(),
  refAnswerSpy: vi.fn(() => Promise.resolve(true))
}));
vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn(() => Promise.resolve()) }
}));
vi.mock("../utils/JORFSearch.utils.ts", async (importActual) => {
  const actual =
    await importActual<typeof import("../utils/JORFSearch.utils.ts")>();
  return { ...actual, callJORFSearchPeople: callPeopleSpy };
});
vi.mock("../commands/ena.ts", () => ({ handleReferenceAnswer: refAnswerSpy }));

import User, { USER_SCHEMA_VERSION } from "../models/User.ts";
import People from "../models/People.ts";
import {
  searchCommand,
  fullHistoryCommand,
  searchPersonHistory,
  followCommand,
  manualFollowCommand
} from "../commands/search.ts";
import { handleFollowUpMessage } from "../entities/FollowUpManager.ts";
import { KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import type { ISession, IUser } from "../types.ts";
import type { JORFSearchItem } from "../entities/JORFSearchResponse.ts";

const sendSpy = vi.fn(() => Promise.resolve(true));
const makeSession = (
  user: IUser | null,
  app: ISession["messageApp"] = "Telegram"
): ISession => ({
  messageApp: app,
  chatId: "se-" + Math.random().toString(36).slice(2),
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
});

const makeUserDoc = () =>
  User.create({
    chatId: "seu-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION,
    status: "active"
  });

const rec = (over: Partial<JORFSearchItem> = {}): JORFSearchItem => ({
  nom: "Dupont",
  prenom: "Jean",
  source_id: "JORFTEXT0001",
  source_date: "2026-06-20",
  source_name: "JORF",
  type_ordre: "nomination",
  organisations: [],
  ...over
});

const HISTORY_TEXT = KEYBOARD_KEYS.FOLLOW_UP_HISTORY.key.text;
const FOLLOW_TEXT = KEYBOARD_KEYS.FOLLOW_UP_FOLLOW.key.text;
const MANUAL_TEXT = KEYBOARD_KEYS.FOLLOW_UP_FOLLOW_MANUAL.key.text;

beforeEach(async () => {
  if (!mongoose.connection.db) throw new Error("no db");
  await mongoose.connection.db.dropDatabase();
  vi.clearAllMocks();
  sendSpy.mockResolvedValue(true);
  callPeopleSpy.mockResolvedValue([rec()]);
  refAnswerSpy.mockResolvedValue(true);
});

describe("searchCommand + handleSearchAnswer", () => {
  it("asks the search question", async () => {
    await searchCommand(makeSession(null));
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("rechercher");
  });

  it("re-asks on an empty answer", async () => {
    const session = makeSession(await makeUserDoc());
    await searchCommand(session);
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "   ");
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'a pas été reconnue");
  });

  it("routes a numeric answer to the reference handler", async () => {
    const session = makeSession(await makeUserDoc());
    await searchCommand(session);
    await handleFollowUpMessage(session, "JORFTEXT000123");
    expect(refAnswerSpy).toHaveBeenCalled();
  });

  it("defers follow-up keys and slash answers", async () => {
    const session = makeSession(await makeUserDoc());
    await searchCommand(session);
    expect(await handleFollowUpMessage(session, FOLLOW_TEXT)).toBe(false);
    await searchCommand(session);
    expect(await handleFollowUpMessage(session, "/x")).toBe(false);
  });

  it("rejects a single-word name", async () => {
    const session = makeSession(await makeUserDoc());
    await searchCommand(session);
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "Dupont");
    expect(String(sendSpy.mock.calls[0][0])).toContain("Saisie incorrecte");
  });

  it("runs a person search for a full name", async () => {
    const session = makeSession(await makeUserDoc());
    await searchCommand(session);
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "Jean Dupont");
    expect(callPeopleSpy).toHaveBeenCalled();
  });
});

describe("fullHistoryCommand", () => {
  it("logs when called without a message", async () => {
    await fullHistoryCommand(makeSession(null));
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it("rejects an empty name", async () => {
    await fullHistoryCommand(makeSession(null), "Historique");
    expect(String(sendSpy.mock.calls[0][0])).toContain("Saisie incorrecte");
  });

  it("runs the full history", async () => {
    await fullHistoryCommand(
      makeSession(await makeUserDoc()),
      "Historique Jean Dupont"
    );
    expect(callPeopleSpy).toHaveBeenCalled();
  });
});

describe("searchPersonHistory — no records", () => {
  beforeEach(() => callPeopleSpy.mockResolvedValue([]));

  it("rejects a single-word query", async () => {
    await searchPersonHistory(makeSession(null), "Historique Dupont");
    expect(String(sendSpy.mock.calls[0][0])).toContain("Saisie incorrecte");
  });

  it("notes a manual follow", async () => {
    const user = await makeUserDoc();
    await user.addFollowedName("Dupont Jean");
    await searchPersonHistory(
      makeSession(await User.findById(user._id)),
      "Historique Jean Dupont"
    );
    expect(String(sendSpy.mock.calls[0][0])).toContain("suivez manuellement");
  });

  it("reports a JORF outage", async () => {
    callPeopleSpy.mockResolvedValue(null);
    await searchPersonHistory(makeSession(null), "Historique Jean Dupont");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "erreur JORFSearch"
    );
  });

  it("reports an unknown person and offers a manual follow", async () => {
    const session = makeSession(await makeUserDoc());
    await searchPersonHistory(session, "Historique Jean Dupont");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("introuvable");
    // manual follow follow-up
    callPeopleSpy.mockResolvedValue(null);
    await handleFollowUpMessage(session, MANUAL_TEXT);
    expect(sendSpy).toHaveBeenCalled();
  });
});

describe("searchPersonHistory — with records", () => {
  it("shows latest history and the follow button when not followed", async () => {
    const session = makeSession(await makeUserDoc());
    await searchPersonHistory(session, "Historique Jean Dupont", "latest");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("ne suivez pas");
  });

  it("shows that the user already follows the person", async () => {
    const person = await People.create({ nom: "Dupont", prenom: "Jean" });
    const user = await makeUserDoc();
    await user.addFollowedPeople(person);
    const session = makeSession(await User.findById(user._id));
    await searchPersonHistory(session, "Historique Jean Dupont", "latest");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("Vous suivez");
  });

  it("transforms a manual name follow into a strong follow", async () => {
    const user = await makeUserDoc();
    await user.addFollowedName("Dupont Jean");
    const session = makeSession(await User.findById(user._id));
    await searchPersonHistory(session, "Historique Jean Dupont", "latest");
    const refreshed = await User.findById(user._id);
    expect(refreshed?.followedNames).not.toContain("Dupont Jean");
    expect(refreshed?.followedPeople.length).toBe(1);
  });

  it("notes extra mentions and full-history hint on Signal", async () => {
    callPeopleSpy.mockResolvedValue([rec(), rec(), rec(), rec()]);
    const session = makeSession(await makeUserDoc(), "Signal");
    await searchPersonHistory(session, "Historique Jean Dupont", "latest");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("autres mentions");
  });

  it("renders the full history", async () => {
    callPeopleSpy.mockResolvedValue([rec(), rec(), rec()]);
    await searchPersonHistory(
      makeSession(await makeUserDoc()),
      "Historique Jean Dupont",
      "full"
    );
    expect(callPeopleSpy).toHaveBeenCalled();
  });

  it("shows the follow button for an anonymous (no-account) viewer", async () => {
    const session = makeSession(null);
    await searchPersonHistory(session, "Historique Jean Dupont", "latest");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("ne suivez pas");
  });

  it("handles a follow-up history selection", async () => {
    const session = makeSession(await makeUserDoc());
    await searchPersonHistory(session, "Historique Jean Dupont", "latest");
    await handleFollowUpMessage(session, HISTORY_TEXT);
    expect(callPeopleSpy).toHaveBeenCalledTimes(2);
  });

  it("handles a follow-up follow selection", async () => {
    const session = makeSession(await makeUserDoc());
    await searchPersonHistory(session, "Historique Jean Dupont", "latest");
    sendSpy.mockClear();
    await handleFollowUpMessage(session, FOLLOW_TEXT);
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "suivez maintenant"
    );
  });

  it("handles a follow-up manual selection", async () => {
    callPeopleSpy.mockResolvedValueOnce([rec()]); // search shows person
    const session = makeSession(await makeUserDoc());
    await searchPersonHistory(session, "Historique Jean Dupont", "latest");
    callPeopleSpy.mockResolvedValue([]); // manual path: not at JO
    const handled = await handleFollowUpMessage(session, MANUAL_TEXT);
    expect(handled).toBe(true);
  });

  it("ignores an unrecognised follow-up answer", async () => {
    const session = makeSession(await makeUserDoc());
    await searchPersonHistory(session, "Historique Jean Dupont", "latest");
    expect(await handleFollowUpMessage(session, "autre")).toBe(false);
  });

  it("logs on error", async () => {
    sendSpy.mockRejectedValueOnce(new Error("x"));
    const person = await People.create({ nom: "Dupont", prenom: "Jean" });
    const user = await makeUserDoc();
    await user.addFollowedName("Dupont Jean");
    void person;
    await searchPersonHistory(
      makeSession(await User.findById(user._id)),
      "Historique Jean Dupont"
    );
    expect(logErrorSpy).toHaveBeenCalled();
  });
});

describe("followCommand", () => {
  it("rejects a short input", async () => {
    await followCommand(makeSession(null), "Suivre Dupont");
    expect(String(sendSpy.mock.calls[0][0])).toContain("Saisie incorrecte");
  });

  it("redirects to search when the person is unknown", async () => {
    callPeopleSpy.mockResolvedValue([]);
    await followCommand(makeSession(await makeUserDoc()), "Suivre Jean Dupont");
    // searchPersonHistory ran (no records -> introuvable / manual offer)
    expect(callPeopleSpy).toHaveBeenCalled();
  });

  it("creates an account and follows a new person", async () => {
    const session = makeSession(null);
    await followCommand(session, "Suivre Jean Dupont");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "suivez maintenant"
    );
  });

  it("reports an already-followed person", async () => {
    const person = await People.create({ nom: "Dupont", prenom: "Jean" });
    const user = await makeUserDoc();
    await user.addFollowedPeople(person);
    const session = makeSession(await User.findById(user._id));
    await followCommand(session, "Suivre Jean Dupont");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("suivez déjà");
  });

  it("logs on error", async () => {
    callPeopleSpy.mockRejectedValue(new Error("x"));
    await followCommand(makeSession(null), "Suivre Jean Dupont");
    expect(logErrorSpy).toHaveBeenCalled();
  });
});

describe("manualFollowCommand", () => {
  it("rejects a short input", async () => {
    await manualFollowCommand(makeSession(null), "SuivreN Dupont");
    expect(String(sendSpy.mock.calls[0][0])).toContain("Saisie incorrecte");
  });

  it("reports a JORF outage", async () => {
    callPeopleSpy.mockResolvedValue(null);
    await manualFollowCommand(makeSession(null), "SuivreN Jean Dupont");
    expect(String(sendSpy.mock.calls[0][0])).toContain("erreur JORFSearch");
  });

  it("upgrades to a strong follow when the person exists at the JO", async () => {
    callPeopleSpy.mockResolvedValue([rec()]);
    const session = makeSession(await makeUserDoc());
    await manualFollowCommand(session, "SuivreN Jean Dupont");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "suivez maintenant"
    );
  });

  it("reports an existing manual follow", async () => {
    callPeopleSpy.mockResolvedValue([]);
    const user = await makeUserDoc();
    await user.addFollowedName("Dupont Jean");
    const session = makeSession(await User.findById(user._id));
    await manualFollowCommand(session, "SuivreN Jean Dupont");
    expect(String(sendSpy.mock.calls[0][0])).toContain("suivez déjà");
  });

  it("adds a new manual follow", async () => {
    callPeopleSpy.mockResolvedValue([]);
    const session = makeSession(null);
    await manualFollowCommand(session, "SuivreN Jean Dupont");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("suivi manuel");
  });
});
