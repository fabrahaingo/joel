import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const { logErrorSpy, searchOrgSpy } = vi.hoisted(() => ({
  logErrorSpy: vi.fn(() => Promise.resolve()),
  searchOrgSpy: vi.fn()
}));
vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn(() => Promise.resolve()) }
}));
vi.mock("../utils/JORFSearch.utils.ts", async (importActual) => {
  const actual =
    await importActual<typeof import("../utils/JORFSearch.utils.ts")>();
  return { ...actual, searchOrganisationWikidataId: searchOrgSpy };
});

import User, { USER_SCHEMA_VERSION } from "../models/User.ts";
import Organisation from "../models/Organisation.ts";
import {
  searchOrganisation,
  searchOrganisationFromStr,
  followOrganisationsFromWikidataIdStr
} from "../commands/followOrganisation.ts";
import { handleFollowUpMessage } from "../entities/FollowUpManager.ts";
import { KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import type { ISession, IUser } from "../types.ts";

const sendSpy = vi.fn(() => Promise.resolve(true));
const makeSession = (
  user: IUser | null,
  app: ISession["messageApp"] = "Telegram"
): ISession => ({
  messageApp: app,
  chatId: "fo-" + Math.random().toString(36).slice(2),
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
    chatId: "fou-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION,
    status: "active"
  });

const FOLLOW_TEXT = KEYBOARD_KEYS.FOLLOW_UP_FOLLOW.key.text;

beforeEach(async () => {
  if (!mongoose.connection.db) throw new Error("no db");
  await mongoose.connection.db.dropDatabase();
  vi.clearAllMocks();
  sendSpy.mockResolvedValue(true);
});

describe("searchOrganisation + search follow-up", () => {
  it("asks for the organisation", async () => {
    await searchOrganisation(makeSession(null));
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("organisation");
  });

  it("logs on error", async () => {
    sendSpy.mockRejectedValueOnce(new Error("x"));
    await searchOrganisation(makeSession(null));
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it("re-asks on an empty answer", async () => {
    const session = makeSession(await makeUserDoc());
    await searchOrganisation(session);
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "   ");
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'a pas été reconnue");
  });

  it("defers follow-up keyboard keys and slash answers", async () => {
    const session = makeSession(await makeUserDoc());
    await searchOrganisation(session);
    expect(await handleFollowUpMessage(session, FOLLOW_TEXT)).toBe(false);
    await searchOrganisation(session);
    expect(await handleFollowUpMessage(session, "/start")).toBe(false);
  });

  it("reports a JORFSearch error", async () => {
    searchOrgSpy.mockResolvedValue(null);
    const session = makeSession(await makeUserDoc());
    await searchOrganisation(session);
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "Conseil");
    expect(String(sendSpy.mock.calls[0][0])).toContain("erreur JORFSearch");
  });

  it("reports no result", async () => {
    searchOrgSpy.mockResolvedValue([]);
    const session = makeSession(await makeUserDoc(), "Signal");
    await searchOrganisation(session);
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "Conseil");
    expect(String(sendSpy.mock.calls[0][0])).toContain("aucun résultat");
  });

  it("shows a single result and follows on confirmation", async () => {
    searchOrgSpy.mockResolvedValue([{ nom: "Conseil", wikidataId: "Q1" }]);
    const session = makeSession(await makeUserDoc());
    await searchOrganisation(session);
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "Conseil");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("Conseil");
    // confirm follow
    await Organisation.create({ wikidataId: "Q1", nom: "Conseil" });
    await handleFollowUpMessage(session, FOLLOW_TEXT);
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "suivez désormais"
    );
  });

  it("reports an already-followed single result", async () => {
    await Organisation.create({ wikidataId: "Q1", nom: "Conseil" });
    const user = await makeUserDoc();
    await user.addFollowedOrganisation("Q1");
    searchOrgSpy.mockResolvedValue([{ nom: "Conseil", wikidataId: "Q1" }]);
    const session = makeSession(await User.findById(user._id), "WhatsApp");
    await searchOrganisation(session);
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "Conseil");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("suivez déjà");
  });

  it("lists multiple results and follows a selection", async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      nom: `Org ${String(i)}`,
      wikidataId: `Q${String(i)}`
    }));
    searchOrgSpy.mockResolvedValue(many);
    const user = await makeUserDoc();
    await user.addFollowedOrganisation("Q0");
    await Organisation.create({ wikidataId: "Q1", nom: "Org 1" });
    const session = makeSession(await User.findById(user._id));
    await searchOrganisation(session);
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "Org");
    expect(String(sendSpy.mock.calls[0][0])).toContain("omis"); // >=10 note
    await handleFollowUpMessage(session, "2"); // selects Q1
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "suivez désormais"
    );
  });

  it("re-asks an invalid selection", async () => {
    searchOrgSpy.mockResolvedValue([
      { nom: "A", wikidataId: "Q1" },
      { nom: "B", wikidataId: "Q2" }
    ]);
    const session = makeSession(await makeUserDoc());
    await searchOrganisation(session);
    await handleFollowUpMessage(session, "A");
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "zzz");
    expect(String(sendSpy.mock.calls[0][0])).toContain("entre 1 et 2");
  });

  it("ignores a non-follow answer on a single result", async () => {
    searchOrgSpy.mockResolvedValue([{ nom: "Conseil", wikidataId: "Q1" }]);
    const session = makeSession(await makeUserDoc());
    await searchOrganisation(session);
    await handleFollowUpMessage(session, "Conseil");
    expect(await handleFollowUpMessage(session, "autre chose")).toBe(false);
  });

  it("lists multiple results with WhatsApp links", async () => {
    searchOrgSpy.mockResolvedValue([
      { nom: "A", wikidataId: "Q1" },
      { nom: "B", wikidataId: "Q2" }
    ]);
    const session = makeSession(await makeUserDoc(), "WhatsApp");
    await searchOrganisation(session);
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "Org");
    expect(String(sendSpy.mock.calls[0][0])).toContain("https://");
  });

  it("re-asks an empty selection and defers a slash selection", async () => {
    searchOrgSpy.mockResolvedValue([
      { nom: "A", wikidataId: "Q1" },
      { nom: "B", wikidataId: "Q2" }
    ]);
    const session = makeSession(await makeUserDoc());
    await searchOrganisation(session);
    await handleFollowUpMessage(session, "Org");
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "   ");
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'a pas été reconnue");
    // re-establish selection follow-up, then slash defers
    await handleFollowUpMessage(session, "Org");
    expect(await handleFollowUpMessage(session, "/start")).toBe(false);
  });
});

describe("searchOrganisationFromStr", () => {
  it("searches with a name", async () => {
    searchOrgSpy.mockResolvedValue([]);
    await searchOrganisationFromStr(
      makeSession(await makeUserDoc()),
      "RechercherO Conseil"
    );
    expect(searchOrgSpy).toHaveBeenCalled();
  });

  it("shows the format prompt with no name", async () => {
    await searchOrganisationFromStr(makeSession(null), "RechercherO");
    expect(String(sendSpy.mock.calls[0][0])).toContain("Format");
  });

  it("logs on error", async () => {
    searchOrgSpy.mockRejectedValue(new Error("x"));
    await searchOrganisationFromStr(
      makeSession(await makeUserDoc()),
      "RechercherO Conseil"
    );
    expect(logErrorSpy).toHaveBeenCalled();
  });
});

describe("followOrganisationsFromWikidataIdStr", () => {
  it("redirects to the format prompt for a single word", async () => {
    await followOrganisationsFromWikidataIdStr(
      makeSession(await makeUserDoc()),
      "SuivreO"
    );
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("Format");
  });

  it("redirects a non-numeric argument to a name search", async () => {
    searchOrgSpy.mockResolvedValue([]);
    await followOrganisationsFromWikidataIdStr(
      makeSession(await makeUserDoc()),
      "SuivreO Conseil"
    );
    expect(searchOrgSpy).toHaveBeenCalled();
  });

  it("follows an id already in the db", async () => {
    await Organisation.create({ wikidataId: "Q1", nom: "Conseil" });
    const session = makeSession(await makeUserDoc());
    await followOrganisationsFromWikidataIdStr(session, "SuivreO Q1");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "suivez désormais"
    );
  });

  it("fetches an unknown id from JORF and follows it", async () => {
    searchOrgSpy.mockResolvedValue([{ nom: "Senat", wikidataId: "Q2" }]);
    const session = makeSession(await makeUserDoc());
    await followOrganisationsFromWikidataIdStr(session, "SuivreO Q2");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("Senat");
  });

  it("creates an account when none exists then follows", async () => {
    await Organisation.create({ wikidataId: "Q1", nom: "Conseil" });
    const session = makeSession(null);
    await followOrganisationsFromWikidataIdStr(session, "SuivreO Q1");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "suivez désormais"
    );
  });

  it("reports a JORFSearch error during id resolution", async () => {
    searchOrgSpy.mockResolvedValue(null);
    const session = makeSession(await makeUserDoc());
    await followOrganisationsFromWikidataIdStr(session, "SuivreO Q9");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "erreur JORFSearch"
    );
  });

  it("reports an unrecognised id", async () => {
    searchOrgSpy.mockResolvedValue([]);
    const session = makeSession(await makeUserDoc());
    await followOrganisationsFromWikidataIdStr(session, "SuivreO Q9");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("pas été reconnu");
  });

  it("reports several unrecognised ids", async () => {
    searchOrgSpy.mockResolvedValue([]);
    const session = makeSession(await makeUserDoc());
    await followOrganisationsFromWikidataIdStr(session, "SuivreO Q8 Q9");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("ids fournis");
  });

  it("reports added and already-followed (mixed, non-Telegram)", async () => {
    await Organisation.create({ wikidataId: "Q1", nom: "Conseil" });
    await Organisation.create({ wikidataId: "Q2", nom: "Senat" });
    const user = await makeUserDoc();
    await user.addFollowedOrganisation("Q1");
    const session = makeSession(await User.findById(user._id), "Signal");
    await followOrganisationsFromWikidataIdStr(session, "SuivreO Q1 Q2");
    const text = String(sendSpy.mock.calls.at(-1)?.[0]);
    expect(text).toContain("suivez désormais");
    expect(text).toContain("suivez déjà");
  });

  it("reports multiple added and multiple already (Telegram)", async () => {
    await Organisation.create({ wikidataId: "Q1", nom: "A" });
    await Organisation.create({ wikidataId: "Q2", nom: "B" });
    await Organisation.create({ wikidataId: "Q3", nom: "C" });
    await Organisation.create({ wikidataId: "Q4", nom: "D" });
    const user = await makeUserDoc();
    await user.addFollowedOrganisation("Q1");
    await user.addFollowedOrganisation("Q2");
    const session = makeSession(await User.findById(user._id));
    await followOrganisationsFromWikidataIdStr(session, "SuivreO Q1 Q2 Q3 Q4");
    const text = String(sendSpy.mock.calls.at(-1)?.[0]);
    expect(text).toContain("suivez désormais les organisations");
    expect(text).toContain("suivez déjà les organisations");
  });

  it("logs on error", async () => {
    sendSpy.mockRejectedValue(new Error("x"));
    await Organisation.create({ wikidataId: "Q1", nom: "Conseil" });
    const session = makeSession(await makeUserDoc());
    await followOrganisationsFromWikidataIdStr(session, "SuivreO Q1");
    expect(logErrorSpy).toHaveBeenCalled();
  });
});
