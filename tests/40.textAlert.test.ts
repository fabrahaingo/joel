import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import mongoose from "mongoose";

const { logErrorSpy } = vi.hoisted(() => ({
  logErrorSpy: vi.fn(() => Promise.resolve())
}));
vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn(() => Promise.resolve()) }
}));

import User, { USER_SCHEMA_VERSION } from "../models/User.ts";
import { Publication } from "../models/Publication.ts";
import { textAlertCommand } from "../commands/textAlert.ts";
import { handleFollowUpMessage } from "../entities/FollowUpManager.ts";
import type { ISession, IUser } from "../types.ts";

const sendSpy = vi.fn(() => Promise.resolve(true));
const makeSession = (
  user: IUser | null,
  app: ISession["messageApp"] = "Telegram"
): ISession => ({
  messageApp: app,
  chatId: "ta-" + Math.random().toString(36).slice(2),
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
    chatId: "tau-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION,
    status: "active"
  });

const seedPublications = (n: number, word = "budget") =>
  Publication.insertMany(
    Array.from({ length: n }, (_, i) => ({
      id: `JORFTEXT${String(i).padStart(4, "0")}`,
      source_id: `JORFTEXT${String(i).padStart(4, "0")}`,
      date: "2026-06-20",
      // Distinct, strictly-descending dates so the strict cap and the fuzzy
      // break-on-oldest path are exercised deterministically.
      date_obj: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
      title: `Decret ${word} numero ${String(i)}`,
      tags: {},
      normalizedTitle: `decret ${word} numero ${String(i)}`,
      normalizedTitleWords: ["decret", word, "numero", String(i)]
    }))
  );

// Run the command then answer the search prompt, returning the assembled
// result text sent back to the user.
const runQuery = async (session: ISession, query: string) => {
  await textAlertCommand(session);
  sendSpy.mockClear();
  await handleFollowUpMessage(session, query);
};

beforeEach(async () => {
  if (!mongoose.connection.db) throw new Error("no db");
  await mongoose.connection.db.dropDatabase();
  await Publication.createIndexes();
  vi.clearAllMocks();
  sendSpy.mockResolvedValue(true);
});
afterEach(() => {
  delete process.env.TEXT_SEARCH_YEARS_BACK;
});

describe("textAlertCommand", () => {
  it("asks for the search text", async () => {
    await textAlertCommand(makeSession(null));
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("rechercher");
  });

  it("logs on error", async () => {
    sendSpy.mockRejectedValueOnce(new Error("x"));
    await textAlertCommand(makeSession(null));
    expect(logErrorSpy).toHaveBeenCalled();
  });
});

describe("search-prompt answers", () => {
  it("re-asks on an empty answer", async () => {
    const session = makeSession(await makeUserDoc());
    await runQuery(session, "   ");
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'a pas été reconnu");
  });

  it("defers a slash answer", async () => {
    const session = makeSession(await makeUserDoc());
    await textAlertCommand(session);
    expect(await handleFollowUpMessage(session, "/start")).toBe(false);
  });

  it("reports no results", async () => {
    const session = makeSession(await makeUserDoc());
    await runQuery(session, "introuvable");
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("Aucun texte");
  });

  it("lists a small result set (<=10)", async () => {
    await seedPublications(3);
    const session = makeSession(await makeUserDoc());
    await runQuery(session, "budget");
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("Voici les");
  });

  it("summarises a medium result set (>10)", async () => {
    await seedPublications(15);
    const session = makeSession(await makeUserDoc());
    await runQuery(session, "budget");
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("textes correspondent");
  });

  it("summarises a large result set (>100)", async () => {
    await seedPublications(105);
    const session = makeSession(await makeUserDoc());
    await runQuery(session, "budget");
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("Plus de 100");
  });

  it("uses plain links for WhatsApp", async () => {
    await seedPublications(2);
    const session = makeSession(await makeUserDoc(), "WhatsApp");
    await runQuery(session, "budget");
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("https://");
  });

  it("notes an already-followed expression", async () => {
    await seedPublications(2);
    const user = await makeUserDoc();
    await user.addFollowedAlertString("budget");
    const session = makeSession(await User.findById(user._id));
    await runQuery(session, "budget");
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("suivez déjà");
  });

  it("notes a close already-followed expression", async () => {
    await seedPublications(2);
    const user = await makeUserDoc();
    await user.addFollowedAlertString("budgets"); // close to "budget"
    const session = makeSession(await User.findById(user._id));
    await runQuery(session, "budget");
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("expression proche");
  });

  it("reports a search error", async () => {
    const spy = vi.spyOn(Publication, "find").mockImplementationOnce(() => {
      throw new Error("db down");
    });
    const session = makeSession(await makeUserDoc());
    await runQuery(session, "budget");
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("erreur est survenue");
    spy.mockRestore();
  });

  it("treats a stopword-only query as no results", async () => {
    const session = makeSession(await makeUserDoc());
    await runQuery(session, "le la les de");
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("Aucun texte");
  });

  it("handles a query that normalises to nothing (with a user)", async () => {
    const session = makeSession(await makeUserDoc());
    await runQuery(session, "!!!");
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("Aucun texte");
  });

  it("logs when the confirmation prompt cannot be sent", async () => {
    await seedPublications(2);
    const session = makeSession(await makeUserDoc());
    sendSpy.mockResolvedValue(false);
    await runQuery(session, "budget");
    expect(logErrorSpy).toHaveBeenCalledWith(
      "Telegram",
      expect.stringContaining("textAlert")
    );
  });

  it("merges broad fuzzy candidates and skips non-matching ones (multi-keyword)", async () => {
    const now = new Date();
    await Publication.collection.insertMany([
      {
        id: "A",
        source_id: "A",
        date: "2026-06-20",
        date_obj: now,
        title: "Decret budget social",
        tags: {},
        normalizedTitle: "decret budget social",
        normalizedTitleWords: ["decret", "budget", "social"]
      },
      {
        // has "budget" word but title doesn't fuzzy-match "budget social" -> skipped
        id: "B",
        source_id: "B",
        date: "2026-06-19",
        date_obj: new Date(now.getTime() - 86400000),
        title: "Loi finances publiques",
        tags: {},
        normalizedTitle: "loi finances publiques",
        normalizedTitleWords: ["budget", "loi", "finances", "publiques"]
      },
      {
        // only the "social" word, but the title fuzzy-includes the full query
        id: "C",
        source_id: "C",
        date: "2026-06-18",
        date_obj: new Date(now.getTime() - 2 * 86400000),
        title: "Aide budget social mesures",
        tags: {},
        normalizedTitle: "aide budget social mesures",
        normalizedTitleWords: ["social", "aide", "mesures"]
      }
    ]);
    const session = makeSession(await makeUserDoc());
    await runQuery(session, "budget social");
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("Voici les");
  });

  it("computes the preview and handles a title with no descriptive part", async () => {
    // Raw insert (bypassing schema defaults) so normalizedTitle is absent ->
    // the preview computes it. A bare type-only title yields no cleaned title.
    await Publication.collection.insertOne({
      id: "RAW1",
      source_id: "RAW1",
      date: "2026-06-20",
      date_obj: new Date(),
      title: "Arrêté",
      tags: {},
      normalizedTitleWords: ["arrete", "budget"]
    });
    const session = makeSession(await makeUserDoc());
    await runQuery(session, "budget");
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("Voici les");
  });
});

describe("confirmation answers", () => {
  const reachConfirmation = async (session: ISession) => {
    await seedPublications(2);
    await runQuery(session, "budget");
    sendSpy.mockClear();
  };

  it("saves the alert on Oui", async () => {
    const user = await makeUserDoc();
    const session = makeSession(await User.findById(user._id));
    await reachConfirmation(session);
    await handleFollowUpMessage(session, "✅ Oui");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "Alerte enregistrée"
    );
    const refreshed = await User.findById(user._id);
    expect(refreshed?.followedMeta.length).toBe(1);
  });

  it("reports an already-followed alert on Oui", async () => {
    const user = await makeUserDoc();
    const session = makeSession(await User.findById(user._id));
    await reachConfirmation(session);
    // Follow the alert after the search (so the answer handler didn't catch it):
    // the confirmation's add then reports it as already-followed.
    await session.user?.addFollowedAlertString("budget");
    await handleFollowUpMessage(session, "Oui");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("suivez déjà");
  });

  it("creates an account and saves the alert on Oui", async () => {
    const session = makeSession(null);
    await reachConfirmation(session);
    await handleFollowUpMessage(session, "Oui");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "Alerte enregistrée"
    );
  });

  it("cancels on Non", async () => {
    const session = makeSession(await makeUserDoc());
    await reachConfirmation(session);
    await handleFollowUpMessage(session, "❌ Non");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("aucune alerte");
  });

  it("re-asks on an empty confirmation", async () => {
    const session = makeSession(await makeUserDoc());
    await reachConfirmation(session);
    await handleFollowUpMessage(session, "   ");
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'a pas été reconnue");
  });

  it("defers a slash confirmation", async () => {
    const session = makeSession(await makeUserDoc());
    await reachConfirmation(session);
    expect(await handleFollowUpMessage(session, "/start")).toBe(false);
  });

  it("re-asks on an unrecognised confirmation", async () => {
    const session = makeSession(await makeUserDoc());
    await reachConfirmation(session);
    await handleFollowUpMessage(session, "peut-etre");
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'a pas été reconnue");
  });
});

describe("TEXT_SEARCH_YEARS_BACK env", () => {
  it("honours a valid override", async () => {
    process.env.TEXT_SEARCH_YEARS_BACK = "5";
    const session = makeSession(await makeUserDoc());
    await runQuery(session, "introuvable"); // no results -> "depuis N ans" shown
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("5 ans");
  });

  it("falls back on an invalid override", async () => {
    process.env.TEXT_SEARCH_YEARS_BACK = "not-a-number";
    const session = makeSession(await makeUserDoc());
    await runQuery(session, "introuvable");
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("2 ans");
  });
});
