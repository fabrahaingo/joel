import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const { deleteEntitiesSpy, logErrorSpy } = vi.hoisted(() => ({
  deleteEntitiesSpy: vi.fn(() => Promise.resolve()),
  logErrorSpy: vi.fn(() => Promise.resolve())
}));

vi.mock("../utils/userDeletion.utils.ts", () => ({
  deleteEntitiesWithNoFollowers: deleteEntitiesSpy,
  deleteUserAndCleanup: vi.fn(() => Promise.resolve())
}));
vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn(() => Promise.resolve()) }
}));

import User, { USER_SCHEMA_VERSION } from "../models/User.ts";
import People from "../models/People.ts";
import Organisation from "../models/Organisation.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import {
  listCommand,
  unfollowCommand,
  unfollowFromStr,
  getAllUserFollowsOrdered,
  getUserFollowsTotal,
  buildFollowsListMessage,
  type UserFollows
} from "../commands/list.ts";
import { handleFollowUpMessage } from "../entities/FollowUpManager.ts";
import type { ISession, IUser } from "../types.ts";

const sendSpy = vi.fn(() => Promise.resolve(true));
const makeSession = (
  user: IUser | null,
  app: ISession["messageApp"] = "Telegram"
): ISession => ({
  messageApp: app,
  chatId: "l-" + Math.random().toString(36).slice(2),
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
    chatId: "lu-" + Math.random().toString(36).slice(2),
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

describe("getUserFollowsTotal / buildFollowsListMessage", () => {
  const follows = (over: Partial<UserFollows> = {}): UserFollows => ({
    functions: [],
    organisations: [],
    peopleAndNames: [],
    meta: [],
    ...over
  });

  it("totals all four follow categories", () => {
    expect(
      getUserFollowsTotal(
        follows({
          functions: [FunctionTags.Ambassadeur],
          meta: [{ alertString: "x" }]
        })
      )
    ).toBe(2);
  });

  it("renders every section for Telegram with inter-item separators", () => {
    const text = buildFollowsListMessage(
      makeSession(null),
      follows({
        functions: [FunctionTags.Ambassadeur, FunctionTags["Préfet"]],
        organisations: [
          { nom: "Conseil", wikidataId: "Q1" } as never,
          { nom: "Senat", wikidataId: "Q2" } as never
        ],
        peopleAndNames: [
          { nomPrenom: "Dupont Jean", JORFSearchLink: "http://x" },
          { nomPrenom: "Manuel Suivi" }
        ],
        meta: [{ alertString: "budget" }, { alertString: "impots" }]
      })
    );
    expect(text).toContain("fonctions");
    expect(text).toContain("Conseil");
    expect(text).toContain("JORFSearch");
    expect(text).toContain("Suivi manuel");
    expect(text).toContain("budget");
  });

  it("renders plain links for non-Telegram and compacts long lists", () => {
    const manyFns = Array.from({ length: 12 }, () => FunctionTags.Ambassadeur);
    const text = buildFollowsListMessage(
      makeSession(null, "WhatsApp"),
      follows({
        functions: manyFns,
        organisations: [{ nom: "Conseil", wikidataId: "Q1" } as never],
        peopleAndNames: [{ nomPrenom: "A B", JORFSearchLink: "http://x" }]
      })
    );
    expect(text).toContain("fonctions");
    expect(text).toContain("Conseil");
  });

  it("uses the third-party perspective", () => {
    const text = buildFollowsListMessage(
      makeSession(null),
      follows({ meta: [{ alertString: "x" }] }),
      { perspective: "thirdParty" }
    );
    expect(text).toContain("Ce compte suit");
  });
});

describe("getAllUserFollowsOrdered", () => {
  it("collects and orders a user's follows", async () => {
    const person = await People.create({ nom: "Dupont", prenom: "Jean" });
    await Organisation.create({ wikidataId: "Q1", nom: "Conseil" });
    await Organisation.create({ wikidataId: "Q2", nom: "Senat" });
    const user = await makeUserDoc();
    await user.addFollowedFunction(FunctionTags.Ambassadeur);
    await user.addFollowedOrganisation("Q1");
    await user.addFollowedOrganisation("Q2");
    await user.addFollowedPeople(person);
    await user.addFollowedName("Martin Paul");
    await user.addFollowedAlertString("budget");
    await user.addFollowedAlertString("impots");

    const fresh = await User.findById(user._id);
    const follows = await getAllUserFollowsOrdered(fresh as IUser);
    expect(follows.functions.length).toBe(1);
    expect(follows.organisations.length).toBe(2);
    expect(follows.peopleAndNames.length).toBe(2);
    expect(follows.meta.length).toBe(2);
  });
});

describe("listCommand", () => {
  it("reports no data when there is no user", async () => {
    await listCommand(makeSession(null));
    expect(String(sendSpy.mock.calls[0][0])).toContain("aucun contact");
  });

  it("reports no data when the user follows nothing", async () => {
    const user = await makeUserDoc();
    await listCommand(makeSession(await User.findById(user._id)));
    expect(String(sendSpy.mock.calls[0][0])).toContain("aucun contact");
  });

  it("lists follows (with a Signal hint)", async () => {
    const user = await makeUserDoc();
    await user.addFollowedAlertString("budget");
    const fresh = await User.findById(user._id);
    await listCommand(makeSession(fresh, "Signal"));
    const text = String(sendSpy.mock.calls.at(-1)?.[0]);
    expect(text).toContain("budget");
    expect(text).toContain("Retirer");
  });

  it("logs on error", async () => {
    const user = await makeUserDoc();
    await user.addFollowedAlertString("budget");
    const fresh = await User.findById(user._id);
    sendSpy.mockRejectedValueOnce(new Error("x"));
    await listCommand(makeSession(fresh));
    expect(logErrorSpy).toHaveBeenCalled();
  });
});

describe("unfollowCommand", () => {
  it("reports no data when there is no user", async () => {
    await unfollowCommand(makeSession(null));
    expect(String(sendSpy.mock.calls[0][0])).toContain("aucun contact");
  });

  it("reports no data when the user follows nothing", async () => {
    const user = await makeUserDoc();
    await unfollowCommand(makeSession(await User.findById(user._id)));
    expect(String(sendSpy.mock.calls[0][0])).toContain("aucun contact");
  });

  it("asks the unfollow question when follows exist", async () => {
    const user = await makeUserDoc();
    await user.addFollowedAlertString("budget");
    const fresh = await User.findById(user._id);
    await unfollowCommand(makeSession(fresh));
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("nombre");
  });

  it("logs on error", async () => {
    const user = await makeUserDoc();
    await user.addFollowedAlertString("budget");
    const fresh = await User.findById(user._id);
    sendSpy.mockRejectedValueOnce(new Error("x"));
    await unfollowCommand(makeSession(fresh));
    expect(logErrorSpy).toHaveBeenCalled();
  });
});

describe("unfollowFromStr", () => {
  it("returns false when there is no user", async () => {
    expect(await unfollowFromStr(makeSession(null), "Retirer 1")).toBe(false);
  });

  it("returns false when the user follows nothing", async () => {
    const user = await makeUserDoc();
    expect(
      await unfollowFromStr(
        makeSession(await User.findById(user._id)),
        "Retirer 1"
      )
    ).toBe(false);
  });

  it("rejects an invalid selection (Telegram keyboard)", async () => {
    const user = await makeUserDoc();
    await user.addFollowedAlertString("budget");
    const fresh = await User.findById(user._id);
    const res = await unfollowFromStr(makeSession(fresh), "Retirer abc");
    expect(res).toBe(false);
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "n'a pas été reconnue"
    );
  });

  it("rejects an invalid selection (non-Telegram)", async () => {
    const user = await makeUserDoc();
    await user.addFollowedAlertString("budget");
    const fresh = await User.findById(user._id);
    const res = await unfollowFromStr(
      makeSession(fresh, "Signal"),
      "Retirer abc"
    );
    expect(res).toBe(false);
  });

  it("unfollows a single function", async () => {
    const user = await makeUserDoc();
    await user.addFollowedFunction(FunctionTags.Ambassadeur);
    const fresh = await User.findById(user._id);
    const res = await unfollowFromStr(makeSession(fresh), "Retirer 1");
    expect(res).toBe(true);
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "ne suivez plus la fonction"
    );
  });

  it("unfollows a single organisation", async () => {
    await Organisation.create({ wikidataId: "Q1", nom: "Conseil" });
    const user = await makeUserDoc();
    await user.addFollowedOrganisation("Q1");
    const fresh = await User.findById(user._id);
    const res = await unfollowFromStr(makeSession(fresh), "Retirer 1");
    expect(res).toBe(true);
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("organisation");
  });

  it("unfollows a single person", async () => {
    const person = await People.create({ nom: "Dupont", prenom: "Jean" });
    const user = await makeUserDoc();
    await user.addFollowedPeople(person);
    const fresh = await User.findById(user._id);
    const res = await unfollowFromStr(makeSession(fresh), "Retirer 1");
    expect(res).toBe(true);
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("personne");
  });

  it("unfollows a single manual name", async () => {
    const user = await makeUserDoc();
    await user.addFollowedName("Martin Paul");
    const fresh = await User.findById(user._id);
    const res = await unfollowFromStr(makeSession(fresh), "Retirer 1");
    expect(res).toBe(true);
  });

  it("unfollows a single alert", async () => {
    const user = await makeUserDoc();
    await user.addFollowedAlertString("budget");
    const fresh = await User.findById(user._id);
    const res = await unfollowFromStr(makeSession(fresh), "Retirer 1");
    expect(res).toBe(true);
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("alerte texte");
  });

  it("unfollows multiple functions (single type)", async () => {
    const user = await makeUserDoc();
    await user.addFollowedFunction(FunctionTags.Ambassadeur);
    await user.addFollowedFunction(FunctionTags["Préfet"]);
    const fresh = await User.findById(user._id);
    const res = await unfollowFromStr(makeSession(fresh), "Retirer 1 2");
    expect(res).toBe(true);
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("les fonctions");
  });

  it("unfollows multiple organisations (single type)", async () => {
    await Organisation.create({ wikidataId: "Q1", nom: "Conseil" });
    await Organisation.create({ wikidataId: "Q2", nom: "Senat" });
    const user = await makeUserDoc();
    await user.addFollowedOrganisation("Q1");
    await user.addFollowedOrganisation("Q2");
    const fresh = await User.findById(user._id);
    const res = await unfollowFromStr(makeSession(fresh), "Retirer 1 2");
    expect(res).toBe(true);
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "les organisations"
    );
  });

  it("unfollows multiple people (single type)", async () => {
    const p1 = await People.create({ nom: "Dupont", prenom: "Jean" });
    const p2 = await People.create({ nom: "Martin", prenom: "Paul" });
    const user = await makeUserDoc();
    await user.addFollowedPeople(p1);
    await user.addFollowedPeople(p2);
    const fresh = await User.findById(user._id);
    const res = await unfollowFromStr(makeSession(fresh), "Retirer 1 2");
    expect(res).toBe(true);
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("les personnes");
  });

  it("unfollows multiple alerts (single type)", async () => {
    const user = await makeUserDoc();
    await user.addFollowedAlertString("budget");
    await user.addFollowedAlertString("impots");
    const fresh = await User.findById(user._id);
    const res = await unfollowFromStr(makeSession(fresh), "Retirer 1 2");
    expect(res).toBe(true);
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "les alertes texte"
    );
  });

  it("renders a mixed unfollow with singular and plural categories", async () => {
    const person = await People.create({ nom: "Dupont", prenom: "Jean" });
    await Organisation.create({ wikidataId: "Q1", nom: "Conseil" });
    await Organisation.create({ wikidataId: "Q2", nom: "Senat" });
    const user = await makeUserDoc();
    await user.addFollowedFunction(FunctionTags.Ambassadeur); // 1 (singular)
    await user.addFollowedOrganisation("Q1"); // 2
    await user.addFollowedOrganisation("Q2"); // 3 (plural orgs)
    await user.addFollowedPeople(person); // 4 (singular person)
    await user.addFollowedAlertString("budget"); // 5
    await user.addFollowedAlertString("impots"); // 6 (plural meta)
    const fresh = await User.findById(user._id);
    const res = await unfollowFromStr(
      makeSession(fresh),
      "Retirer 1 2 3 4 5 6"
    );
    expect(res).toBe(true);
    const text = String(sendSpy.mock.calls.at(-1)?.[0]);
    expect(text).toContain("les items");
    expect(text).toContain("Fonction :");
    expect(text).toContain("Organisations :");
    expect(text).toContain("Personne :");
    expect(text).toContain("Alertes texte :");
  });

  it("renders a mixed unfollow with plural functions and people", async () => {
    const p1 = await People.create({ nom: "Dupont", prenom: "Jean" });
    const p2 = await People.create({ nom: "Martin", prenom: "Paul" });
    await Organisation.create({ wikidataId: "Q1", nom: "Conseil" });
    const user = await makeUserDoc();
    await user.addFollowedFunction(FunctionTags.Ambassadeur); // 1
    await user.addFollowedFunction(FunctionTags["Préfet"]); // 2 (plural fns)
    await user.addFollowedOrganisation("Q1"); // 3 (singular org)
    await user.addFollowedPeople(p1); // 4
    await user.addFollowedPeople(p2); // 5 (plural people)
    await user.addFollowedAlertString("budget"); // 6 (singular meta)
    const fresh = await User.findById(user._id);
    const res = await unfollowFromStr(
      makeSession(fresh),
      "Retirer 1 2 3 4 5 6"
    );
    expect(res).toBe(true);
    const text = String(sendSpy.mock.calls.at(-1)?.[0]);
    expect(text).toContain("Fonctions :");
    expect(text).toContain("Organisation :");
    expect(text).toContain("Personnes :");
    expect(text).toContain("Alerte texte :");
  });

  it("unfollows a mix of types and deletes the now-empty user", async () => {
    const person = await People.create({ nom: "Dupont", prenom: "Jean" });
    await Organisation.create({ wikidataId: "Q1", nom: "Conseil" });
    const user = await makeUserDoc();
    await user.addFollowedFunction(FunctionTags.Ambassadeur);
    await user.addFollowedOrganisation("Q1");
    await user.addFollowedPeople(person);
    await user.addFollowedAlertString("budget");
    const fresh = await User.findById(user._id);
    // order: functions(1), orgs(2), people(3), meta(4) -> remove all
    const res = await unfollowFromStr(makeSession(fresh), "Retirer 1 2 3 4");
    expect(res).toBe(true);
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("les items");
    expect(deleteEntitiesSpy).toHaveBeenCalled();
    expect(await User.findById(user._id)).toBeNull();
  });

  it("logs on error", async () => {
    const user = await makeUserDoc();
    await user.addFollowedAlertString("budget");
    const fresh = await User.findById(user._id);
    sendSpy.mockRejectedValueOnce(new Error("x"));
    const res = await unfollowFromStr(makeSession(fresh), "Retirer 1");
    expect(res).toBe(false);
    expect(logErrorSpy).toHaveBeenCalled();
  });
});

describe("unfollow follow-up", () => {
  it("rejects an empty follow-up answer", async () => {
    const user = await makeUserDoc();
    await user.addFollowedAlertString("budget");
    const session = makeSession(await User.findById(user._id));
    await unfollowCommand(session);
    sendSpy.mockClear();
    const handled = await handleFollowUpMessage(session, "   ");
    expect(handled).toBe(true);
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'a pas été reconnue");
  });

  it("processes a valid follow-up answer", async () => {
    const user = await makeUserDoc();
    await user.addFollowedAlertString("budget");
    const session = makeSession(await User.findById(user._id));
    await unfollowCommand(session);
    sendSpy.mockClear();
    const handled = await handleFollowUpMessage(session, "1");
    expect(handled).toBe(true);
  });
});
