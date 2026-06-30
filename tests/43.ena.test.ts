import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import mongoose from "mongoose";

const { logErrorSpy, tagSpy, orgSpy, refSpy, askSearchSpy } = vi.hoisted(
  () => ({
    logErrorSpy: vi.fn(() => Promise.resolve()),
    tagSpy: vi.fn(),
    orgSpy: vi.fn(),
    refSpy: vi.fn(),
    askSearchSpy: vi.fn(() => Promise.resolve())
  })
);
vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn(() => Promise.resolve()) }
}));
vi.mock("../utils/JORFSearch.utils.ts", async (importActual) => {
  const actual =
    await importActual<typeof import("../utils/JORFSearch.utils.ts")>();
  return {
    ...actual,
    callJORFSearchTag: tagSpy,
    callJORFSearchOrganisation: orgSpy,
    callJORFSearchReference: refSpy
  };
});
vi.mock("../commands/search.ts", () => ({ askSearchQuestion: askSearchSpy }));

import User, { USER_SCHEMA_VERSION } from "../models/User.ts";
import { Publication } from "../models/Publication.ts";
import {
  enaCommand,
  promosCommand,
  handleReferenceAnswer
} from "../commands/ena.ts";
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
  chatId: "en-" + Math.random().toString(36).slice(2),
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
    chatId: "enu-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION,
    status: "active"
  });

const eleve = (
  nom: string,
  over: Partial<JORFSearchItem> = {}
): JORFSearchItem => ({
  nom,
  prenom: "X",
  source_id: "JORFTEXT0001",
  source_date: "2026-06-20",
  source_name: "JORF",
  type_ordre: "nomination",
  organisations: [],
  ...over
});

beforeEach(async () => {
  if (!mongoose.connection.db) throw new Error("no db");
  await mongoose.connection.db.dropDatabase();
  vi.clearAllMocks();
  sendSpy.mockResolvedValue(true);
  tagSpy.mockResolvedValue([eleve("Alpha"), eleve("Beta")]);
  orgSpy.mockResolvedValue([eleve("Gamma", { eleve_ena: "2025-2027" })]);
  refSpy.mockResolvedValue([eleve("Delta")]);
  vi.stubGlobal("setTimeout", (fn: () => void) => {
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("enaCommand / promosCommand", () => {
  it("asks for a promo", async () => {
    await enaCommand(makeSession(null));
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("promo");
  });

  it("logs on error in enaCommand", async () => {
    sendSpy.mockRejectedValueOnce(new Error("x"));
    await enaCommand(makeSession(null));
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it("lists promotions (Signal hint)", async () => {
    await promosCommand(makeSession(null, "Signal"));
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("INSP");
  });

  it("logs on error in promosCommand", async () => {
    sendSpy.mockRejectedValueOnce(new Error("x"));
    await promosCommand(makeSession(null));
    expect(logErrorSpy).toHaveBeenCalled();
  });
});

describe("promo follow-up", () => {
  const startPromo = async (session: ISession) => {
    await enaCommand(session);
    sendSpy.mockClear();
  };

  it("re-asks on an empty answer", async () => {
    const session = makeSession(await makeUserDoc());
    await startPromo(session);
    await handleFollowUpMessage(session, "   ");
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'a pas été reconnue");
  });

  it("rejects a promo too old for the JO", async () => {
    const session = makeSession(await makeUserDoc());
    await startPromo(session);
    await handleFollowUpMessage(session, "1989-1991");
    expect(String(sendSpy.mock.calls[0][0])).toContain("trop ancienne");
  });

  it("rejects an unknown promo (Signal hint)", async () => {
    const session = makeSession(await makeUserDoc(), "Signal");
    await startPromo(session);
    await handleFollowUpMessage(session, "zzznope");
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'a pas été reconnue");
  });

  it("reports a JORFSearch outage", async () => {
    tagSpy.mockResolvedValue(null);
    const session = makeSession(await makeUserDoc());
    await startPromo(session);
    await handleFollowUpMessage(session, "2022-2023"); // ENA
    expect(String(sendSpy.mock.calls[0][0])).toContain("erreur JORFSearch");
  });

  it("logs when a promo has no result", async () => {
    tagSpy.mockResolvedValue([]);
    const session = makeSession(await makeUserDoc());
    await startPromo(session);
    await handleFollowUpMessage(session, "2022-2023");
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it("resolves an INSP promo via its organisation", async () => {
    const session = makeSession(await makeUserDoc());
    await startPromo(session);
    await handleFollowUpMessage(session, "Gisèle Halimi"); // INSP by name
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("élèves");
  });

  it("confirms and adds the whole promo (creating an account)", async () => {
    const session = makeSession(null);
    await startPromo(session);
    await handleFollowUpMessage(session, "2022-2023"); // ENA -> 2 students
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "oui");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "ont été ajoutées"
    );
    const refreshed = await User.findOne({ messageApp: "Telegram" });
    expect(refreshed?.followedPeople.length ?? 0).toBeGreaterThan(0);
  });

  it("cancels on non", async () => {
    const session = makeSession(await makeUserDoc());
    await startPromo(session);
    await handleFollowUpMessage(session, "2022-2023");
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "non");
    expect(String(sendSpy.mock.calls[0][0])).toContain("aucun ajout");
  });

  it("re-asks on an empty/unrecognised confirmation", async () => {
    const session = makeSession(await makeUserDoc());
    await startPromo(session);
    await handleFollowUpMessage(session, "2022-2023");
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "   ");
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'a pas été reconnue");
  });

  it("defers a follow-up keyboard key", async () => {
    const session = makeSession(await makeUserDoc());
    await startPromo(session);
    expect(
      await handleFollowUpMessage(
        session,
        KEYBOARD_KEYS.FOLLOW_UP_FOLLOW.key.text
      )
    ).toBe(false);
  });

  it("defers a slash confirmation", async () => {
    const session = makeSession(await makeUserDoc());
    await startPromo(session);
    await handleFollowUpMessage(session, "2022-2023");
    expect(await handleFollowUpMessage(session, "/x")).toBe(false);
  });

  it("re-asks an unrecognised confirmation", async () => {
    const session = makeSession(await makeUserDoc());
    await startPromo(session);
    await handleFollowUpMessage(session, "2022-2023");
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "peut-etre");
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'a pas été reconnue");
  });
});

describe("handleReferenceAnswer", () => {
  it("defers follow-up keys and slash answers", async () => {
    const session = makeSession(await makeUserDoc());
    expect(
      await handleReferenceAnswer(
        session,
        KEYBOARD_KEYS.FOLLOW_UP_FOLLOW.key.text
      )
    ).toBe(false);
    expect(await handleReferenceAnswer(session, "/x")).toBe(false);
  });

  it("sorts multiple referenced people (incl. equal names)", async () => {
    refSpy.mockResolvedValue([
      eleve("Delta"),
      eleve("Alpha"),
      eleve("Charlie"),
      eleve("Alpha")
    ]);
    const session = makeSession(await makeUserDoc());
    await handleReferenceAnswer(session, "JORFTEXT000001");
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("Alpha");
    expect(text).toContain("Delta");
  });

  it("reports a JORFSearch outage", async () => {
    refSpy.mockResolvedValue(null);
    const session = makeSession(await makeUserDoc());
    await handleReferenceAnswer(session, "JORFTEXT000001");
    expect(String(sendSpy.mock.calls[0][0])).toContain("erreur JORFSearch");
  });

  it("logs when the text is not in the db and lists nominations", async () => {
    const session = makeSession(await makeUserDoc());
    await handleReferenceAnswer(session, "JORFTEXT000001");
    expect(logErrorSpy).toHaveBeenCalledWith(
      "Telegram",
      expect.stringContaining("not in dB")
    );
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("mentionne");
  });

  it("uses the publication title when the text is known", async () => {
    await Publication.create({
      id: "JORFTEXT000002",
      source_id: "JORFTEXT000002",
      date: "2026-06-20",
      date_obj: new Date(),
      title: "Decret du jour",
      tags: {}
    });
    const session = makeSession(await makeUserDoc());
    await handleReferenceAnswer(session, "JORFTEXT000002");
    const text = sendSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("Decret du jour");
  });

  it("reports an empty reference and reopens search", async () => {
    refSpy.mockResolvedValue([]);
    const session = makeSession(await makeUserDoc());
    await handleReferenceAnswer(session, "JORFTEXT000003");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "aucune nomination"
    );
    expect(askSearchSpy).toHaveBeenCalled();
  });

  it("confirms and adds the referenced people (creating an account)", async () => {
    const session = makeSession(null);
    await handleReferenceAnswer(session, "JORFTEXT000001");
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "oui");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("ajoutées");
  });

  it("cancels the reference confirmation on non", async () => {
    const session = makeSession(await makeUserDoc());
    await handleReferenceAnswer(session, "JORFTEXT000001");
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "non");
    expect(String(sendSpy.mock.calls[0][0])).toContain("aucun ajout");
  });

  it("re-asks an empty reference confirmation", async () => {
    const session = makeSession(await makeUserDoc());
    await handleReferenceAnswer(session, "JORFTEXT000001");
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "   ");
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'a pas été reconnue");
  });

  it("defers a slash reference confirmation", async () => {
    const session = makeSession(await makeUserDoc());
    await handleReferenceAnswer(session, "JORFTEXT000001");
    expect(await handleFollowUpMessage(session, "/x")).toBe(false);
  });

  it("rejects an unrecognised reference confirmation", async () => {
    const session = makeSession(await makeUserDoc());
    await handleReferenceAnswer(session, "JORFTEXT000001");
    sendSpy.mockClear();
    await handleFollowUpMessage(session, "peut-etre");
    expect(String(sendSpy.mock.calls[0][0])).toContain("n'a pas été reconnue");
  });
});
