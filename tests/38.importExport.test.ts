import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const { logErrorSpy, randomBytesSpy } = vi.hoisted(() => ({
  logErrorSpy: vi.fn(() => Promise.resolve()),
  randomBytesSpy: vi.fn()
}));

vi.mock("node:crypto", async (importActual) => {
  const actual = await importActual<typeof import("node:crypto")>();
  return { ...actual, randomBytes: randomBytesSpy };
});
vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn(() => Promise.resolve()) }
}));

import User, { USER_SCHEMA_VERSION } from "../models/User.ts";
import People from "../models/People.ts";
import { exportCommand, importCommand } from "../commands/importExport.ts";
import { handleFollowUpMessage } from "../entities/FollowUpManager.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import type { ISession, IUser } from "../types.ts";

const sendSpy = vi.fn(() => Promise.resolve(true));
const makeSession = (user: IUser | null): ISession =>
  ({
    messageApp: "Telegram",
    chatId: "ie-" + Math.random().toString(36).slice(2),
    language_code: "fr",
    user,
    isReply: false,
    lastEngagementAt: new Date(),
    loadUser: () => Promise.resolve(user),
    createUser: vi.fn(function (this: ISession) {
      return User.findOrCreate(this).then((u) => {
        (this as { user: IUser }).user = u;
      });
    }),
    sendMessage: sendSpy,
    sendTypingAction: vi.fn(),
    log: vi.fn(),
    extractMessageAppsOptions: () => ({})
  }) as unknown as ISession;

const makeUserDoc = () =>
  User.create({
    chatId: "ieu-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION,
    status: "active"
  });

beforeEach(async () => {
  if (!mongoose.connection.db) throw new Error("no db");
  await mongoose.connection.db.dropDatabase();
  vi.clearAllMocks();
  sendSpy.mockResolvedValue(true);
  randomBytesSpy.mockReturnValue(Buffer.from("0123456789", "hex"));
});

describe("exportCommand", () => {
  it("refuses when the user follows nothing", async () => {
    await exportCommand(makeSession(null));
    expect(String(sendSpy.mock.calls[0][0])).toContain("Aucun compte");
  });

  it("stores a transfer code and returns it", async () => {
    const user = await makeUserDoc();
    await user.addFollowedAlertString("budget");
    const fresh = await User.findById(user._id);
    await exportCommand(makeSession(fresh));
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("code d'export");
    const refreshed = await User.findById(user._id);
    expect(refreshed?.transferData?.code).toBeTruthy();
  });

  it("recovers from a code collision", async () => {
    // Force a deterministic code, then seed a colliding user.
    const code = "0123456789".toUpperCase();
    const other = await makeUserDoc();
    other.transferData = { code, expiresAt: new Date(Date.now() + 1000) };
    await other.save();

    const user = await makeUserDoc();
    await user.addFollowedAlertString("budget");
    const fresh = await User.findById(user._id);
    await exportCommand(makeSession(fresh));
    expect(logErrorSpy).toHaveBeenCalled();
  });
});

describe("importCommand + handleImporterCode", () => {
  const exportingUser = async () => {
    const person = await People.create({ nom: "Durand", prenom: "Marie" });
    const src = await makeUserDoc();
    await src.addFollowedAlertString("budget");
    await src.addFollowedName("Martin Paul");
    await src.addFollowedPeople(person);
    await src.addFollowedOrganisation("Q9");
    await src.addFollowedFunction(FunctionTags.Ambassadeur);
    src.transferData = {
      code: "CODE123",
      expiresAt: new Date(Date.now() + 60_000)
    };
    await src.save();
    return src;
  };

  const startImport = async (session: ISession) => {
    await importCommand(session);
    sendSpy.mockClear();
  };

  it("asks for the code", async () => {
    await importCommand(makeSession(await makeUserDoc()));
    expect(String(sendSpy.mock.calls[0][0])).toContain("code d'import");
  });

  it("re-asks on an empty code", async () => {
    const session = makeSession(await makeUserDoc());
    await startImport(session);
    const handled = await handleFollowUpMessage(session, "   ");
    expect(handled).toBe(true);
    expect(String(sendSpy.mock.calls[0][0])).toContain("code est vide");
  });

  it("rejects an unknown code", async () => {
    const session = makeSession(await makeUserDoc());
    await startImport(session);
    await handleFollowUpMessage(session, "NOPE");
    expect(String(sendSpy.mock.calls[0][0])).toContain("pas valide");
  });

  it("rejects an expired code", async () => {
    const src = await makeUserDoc();
    await src.addFollowedAlertString("budget");
    src.transferData = {
      code: "EXPIRED",
      expiresAt: new Date(Date.now() - 1000)
    };
    await src.save();
    const session = makeSession(await makeUserDoc());
    await startImport(session);
    await handleFollowUpMessage(session, "EXPIRED");
    expect(String(sendSpy.mock.calls[0][0])).toContain("expiré");
  });

  it("rejects importing your own code", async () => {
    const src = await exportingUser();
    const session = makeSession(await User.findById(src._id));
    await startImport(session);
    await handleFollowUpMessage(session, "CODE123");
    expect(String(sendSpy.mock.calls[0][0])).toContain("compte actuel");
  });

  it("reports when the source follows nothing", async () => {
    const src = await makeUserDoc();
    src.transferData = {
      code: "EMPTY",
      expiresAt: new Date(Date.now() + 60_000)
    };
    await src.save();
    const session = makeSession(await makeUserDoc());
    await startImport(session);
    await handleFollowUpMessage(session, "EMPTY");
    expect(String(sendSpy.mock.calls[0][0])).toContain("rien à importer");
  });

  it("copies follows into the recipient (deduping)", async () => {
    const person = await People.create({ nom: "Dupont", prenom: "Jean" });
    const src = await makeUserDoc();
    await src.addFollowedPeople(person);
    await src.addFollowedName("Martin Paul");
    await src.addFollowedOrganisation("Q1");
    await src.addFollowedFunction(FunctionTags.Ambassadeur);
    await src.addFollowedAlertString("budget");
    src.transferData = {
      code: "FULL",
      expiresAt: new Date(Date.now() + 60_000)
    };
    await src.save();

    const dest = await makeUserDoc();
    // dest already follows the same items -> exercises every dedup skip path
    await dest.addFollowedPeople(person);
    await dest.addFollowedOrganisation("Q1");
    await dest.addFollowedName("Martin Paul");
    await dest.addFollowedFunction(FunctionTags.Ambassadeur);

    const session = makeSession(await User.findById(dest._id));
    await startImport(session);
    await handleFollowUpMessage(session, "FULL");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("copiés");
    const refreshed = await User.findById(dest._id);
    expect(refreshed?.followedFunctions.length).toBe(1);
    // source's transfer code consumed
    const refreshedSrc = await User.findById(src._id);
    expect(refreshedSrc?.transferData).toBeUndefined();
  });

  it("creates the recipient account when none exists (pushes all follows)", async () => {
    const src = await exportingUser();
    const session = makeSession(null);
    await startImport(session);
    await handleFollowUpMessage(session, "CODE123");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain("copiés");
    void src;
  });

  it("errors when several users share the code", async () => {
    for (let i = 0; i < 2; i++) {
      const u = await makeUserDoc();
      u.transferData = {
        code: "DUP",
        expiresAt: new Date(Date.now() + 60_000)
      };
      await u.save();
    }
    const session = makeSession(await makeUserDoc());
    await startImport(session);
    await handleFollowUpMessage(session, "DUP");
    expect(String(sendSpy.mock.calls[0][0])).toContain("erreur est survenue");
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it("errors when the recipient account cannot be created", async () => {
    const src = await exportingUser();
    const session = makeSession(null);
    // createUser leaves session.user null -> the recovery branch.
    (session as { createUser: () => Promise<void> }).createUser = vi.fn(() =>
      Promise.resolve()
    );
    await startImport(session);
    await handleFollowUpMessage(session, "CODE123");
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "création du compte"
    );
    void src;
  });
});
