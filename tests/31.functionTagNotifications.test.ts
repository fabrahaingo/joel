import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const { sendMessageSpy, templateSpy, logErrorSpy } = vi.hoisted(() => ({
  sendMessageSpy: vi.fn(() => Promise.resolve(true)),
  templateSpy: vi.fn(() => Promise.resolve(true)),
  logErrorSpy: vi.fn(() => Promise.resolve())
}));

vi.mock("../entities/Session.ts", async (importActual) => {
  const actual = await importActual<typeof import("../entities/Session.ts")>();
  return { ...actual, sendMessage: sendMessageSpy };
});
vi.mock("../entities/WhatsAppSession.ts", async (importActual) => {
  const actual =
    await importActual<typeof import("../entities/WhatsAppSession.ts")>();
  return { ...actual, sendWhatsAppTemplate: templateSpy };
});
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn(() => Promise.resolve()) }
}));
vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));

import User, { USER_SCHEMA_VERSION } from "../models/User.ts";

const ZERO_UPDATE = { modifiedCount: 0 } as unknown as Awaited<
  ReturnType<typeof User.updateOne>
>;
import { FunctionTags } from "../entities/FunctionTags.ts";
import {
  notifyFunctionTagsUpdates,
  sendTagUpdates
} from "../notifications/functionTagNotifications.ts";
import type {
  ExternalMessageOptions,
  ExtendedMiniUserInfo
} from "../entities/Session.ts";
import type { JORFSearchItem } from "../entities/JORFSearchResponse.ts";

const HOUR = 60 * 60 * 1000;
const TAG = FunctionTags.Ambassadeur;
const opts = { whatsAppAPI: {} as unknown } as ExternalMessageOptions;

const record = (over: Partial<JORFSearchItem> = {}): JORFSearchItem =>
  ({
    [TAG]: "ok",
    nom: "Dupont",
    prenom: "Jean",
    source_id: "JORFTEXT0001",
    source_date: "2026-06-20",
    source_name: "JORF",
    type_ordre: "nomination",
    organisations: [],
    ...over
  }) as unknown as JORFSearchItem;

const makeUser = (tag: FunctionTags = TAG, over = {}) =>
  User.create({
    chatId: "f-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION,
    status: "active",
    lastEngagementAt: new Date(),
    followedFunctions: [
      { functionTag: tag, lastUpdate: new Date("2020-01-01") }
    ],
    ...over
  });

beforeEach(async () => {
  if (!mongoose.connection.db) throw new Error("no db");
  await mongoose.connection.db.dropDatabase();
  vi.clearAllMocks();
  sendMessageSpy.mockResolvedValue(true);
  templateSpy.mockResolvedValue(true);
});

describe("notifyFunctionTagsUpdates — early exits", () => {
  it("returns when there are no records", async () => {
    await notifyFunctionTagsUpdates([], ["Telegram"], opts, new Date());
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("returns when no user follows the tag", async () => {
    await notifyFunctionTagsUpdates([record()], ["Telegram"], opts, new Date());
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("throws on empty userIds", async () => {
    await makeUser();
    await expect(
      notifyFunctionTagsUpdates([record()], ["Telegram"], opts, new Date(), [])
    ).rejects.toThrow("Empty userIds");
  });
});

describe("notifyFunctionTagsUpdates — send + lastUpdate", () => {
  it("sends and bumps lastUpdate", async () => {
    const user = await makeUser();
    await notifyFunctionTagsUpdates([record()], ["Telegram"], opts, new Date());
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    const refreshed = await User.findById(user._id).lean();
    expect(
      refreshed?.followedFunctions[0].lastUpdate.getTime()
    ).toBeGreaterThan(new Date("2020-01-01").getTime());
  });

  it("skips records older than lastUpdate", async () => {
    await makeUser(TAG, {
      followedFunctions: [{ functionTag: TAG, lastUpdate: new Date() }]
    });
    await notifyFunctionTagsUpdates(
      [record({ source_date: "2020-06-20" })],
      ["Telegram"],
      opts,
      new Date()
    );
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("restricts to provided userIds", async () => {
    const target = await makeUser();
    await makeUser();
    await notifyFunctionTagsUpdates(
      [record()],
      ["Telegram"],
      opts,
      new Date(),
      [target._id]
    );
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it("does not bump lastUpdate on send failure", async () => {
    sendMessageSpy.mockResolvedValue(false);
    const user = await makeUser();
    await notifyFunctionTagsUpdates([record()], ["Telegram"], opts, new Date());
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.followedFunctions[0].lastUpdate.getTime()).toBe(
      new Date("2020-01-01").getTime()
    );
  });

  it("logs when no lastUpdate is modified after a send", async () => {
    await makeUser();
    const spy = vi.spyOn(User, "updateOne").mockResolvedValue(ZERO_UPDATE);
    await notifyFunctionTagsUpdates([record()], ["Telegram"], opts, new Date());
    expect(logErrorSpy).toHaveBeenCalledWith(
      "Telegram",
      expect.stringContaining("No lastUpdate updated")
    );
    spy.mockRestore();
  });
});

describe("notifyFunctionTagsUpdates — WhatsApp re-engagement", () => {
  const waUser = () =>
    makeUser(TAG, {
      chatId: "wa-" + Math.random().toString(36).slice(2),
      messageApp: "WhatsApp",
      waitingReengagement: false,
      lastEngagementAt: new Date()
    });

  it("logs and aborts when the WhatsApp API is missing", async () => {
    await waUser();
    await notifyFunctionTagsUpdates(
      [record()],
      ["WhatsApp"],
      {},
      new Date(Date.now() + 25 * HOUR)
    );
    expect(logErrorSpy).toHaveBeenCalled();
    expect(templateSpy).not.toHaveBeenCalled();
  });

  it("does not flag waitingReengagement when the template fails", async () => {
    templateSpy.mockResolvedValue(false);
    const user = await waUser();
    await notifyFunctionTagsUpdates(
      [record()],
      ["WhatsApp"],
      opts,
      new Date(Date.now() + 25 * HOUR)
    );
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.waitingReengagement).toBe(false);
  });

  it("logs when waitingReengagement is not updated", async () => {
    await waUser();
    const spy = vi.spyOn(User, "updateOne").mockResolvedValue(ZERO_UPDATE);
    await notifyFunctionTagsUpdates(
      [record()],
      ["WhatsApp"],
      opts,
      new Date(Date.now() + 25 * HOUR)
    );
    expect(logErrorSpy).toHaveBeenCalledWith(
      "WhatsApp",
      expect.stringContaining("No waitingReengagement updated")
    );
    spy.mockRestore();
  });

  it("sends in-window with forceWHMessages", async () => {
    await waUser();
    await notifyFunctionTagsUpdates(
      [record()],
      ["WhatsApp"],
      opts,
      new Date(Date.now() + 25 * HOUR),
      undefined,
      true
    );
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });
});

describe("sendTagUpdates", () => {
  const userInfo: ExtendedMiniUserInfo = {
    messageApp: "Telegram",
    chatId: "123",
    status: "active",
    hasAccount: true,
    waitingReengagement: false,
    lastEngagementAt: new Date()
  };

  it("returns true with no tags", async () => {
    expect(await sendTagUpdates(userInfo, new Map(), opts)).toBe(true);
  });

  it("formats a tag update", async () => {
    const map = new Map([[TAG, [record()]]]);
    expect(await sendTagUpdates(userInfo, map, opts)).toBe(true);
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it("logs and skips an empty record group", async () => {
    const map = new Map([[TAG, [] as JORFSearchItem[]]]);
    await sendTagUpdates(userInfo, map, opts);
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it("renders a separator between multiple tags", async () => {
    const PREFET = FunctionTags["Préfet"];
    const map = new Map([
      [TAG, [record()]],
      [PREFET, [record({ [PREFET]: "ok" })]]
    ]);
    expect(await sendTagUpdates(userInfo, map, opts)).toBe(true);
    expect(String(sendMessageSpy.mock.calls[0][1])).toContain("====");
  });

  it("groups cabinet_ministeriel records by cabinet with a fallback", async () => {
    const cab = (cabinet: string | undefined, id: string): JORFSearchItem =>
      ({
        cabinet_ministeriel: true,
        cabinet,
        nom: "X",
        prenom: "Y",
        source_id: id,
        source_date: "2026-06-20",
        source_name: "JORF",
        type_ordre: "nomination",
        organisations: []
      }) as unknown as JORFSearchItem;
    const map = new Map([
      [
        FunctionTags["Cabinet ministériel"],
        [
          cab("Ministère B", "JORFTEXT0001"),
          cab("Ministère A", "JORFTEXT0002"),
          cab(undefined, "JORFTEXT0003")
        ]
      ]
    ]);
    expect(await sendTagUpdates(userInfo, map, opts)).toBe(true);
    const msg = String(sendMessageSpy.mock.calls[0][1]);
    expect(msg).toContain("Ministère A");
    expect(msg).toContain("Autres ministères");
  });

  it("falls back to a flat list when records have no reference to group by", async () => {
    // No source_id -> reference grouping yields nothing -> fallback formatter.
    const map = new Map([
      [TAG, [record({ source_id: undefined as unknown as string })]]
    ]);
    expect(await sendTagUpdates(userInfo, map, opts)).toBe(true);
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it("returns false when the send fails", async () => {
    sendMessageSpy.mockResolvedValue(false);
    const map = new Map([[TAG, [record()]]]);
    expect(await sendTagUpdates(userInfo, map, opts)).toBe(false);
  });
});
