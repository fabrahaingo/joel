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
import People from "../models/People.ts";
import {
  notifyNameMentionUpdates,
  sendNameMentionUpdates,
  updateFollowedNamesToFollowedPeople
} from "../notifications/nameNotifications.ts";
import type {
  ExternalMessageOptions,
  ExtendedMiniUserInfo
} from "../entities/Session.ts";
import type { JORFSearchItem } from "../entities/JORFSearchResponse.ts";

const HOUR = 60 * 60 * 1000;
const opts = { whatsAppAPI: {} as unknown } as ExternalMessageOptions;

const record = (over: Partial<JORFSearchItem> = {}): JORFSearchItem => ({
  nom: "Dupont",
  prenom: "Jean",
  source_id: "JORFTEXT0001",
  source_date: "2026-06-20",
  source_name: "JORF",
  type_ordre: "nomination",
  organisations: [],
  ...over
});

const makeUser = (over = {}) =>
  User.create({
    chatId: "n-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION,
    status: "active",
    lastEngagementAt: new Date(),
    followedNames: ["Jean Dupont"],
    ...over
  });

beforeEach(async () => {
  if (!mongoose.connection.db) throw new Error("no db");
  await mongoose.connection.db.dropDatabase();
  vi.clearAllMocks();
  sendMessageSpy.mockResolvedValue(true);
  templateSpy.mockResolvedValue(true);
});

describe("notifyNameMentionUpdates — early exits", () => {
  it("returns when no user follows names", async () => {
    await notifyNameMentionUpdates([record()], ["Telegram"], opts, new Date());
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("throws on empty userIds", async () => {
    await expect(
      notifyNameMentionUpdates([record()], ["Telegram"], opts, new Date(), [])
    ).rejects.toThrow("Empty userIds");
  });

  it("returns when no followed name is mentioned", async () => {
    await makeUser({ followedNames: ["Quelqu'un Dautre"] });
    await notifyNameMentionUpdates([record()], ["Telegram"], opts, new Date());
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });
});

describe("notifyNameMentionUpdates — converts name follow to people follow", () => {
  it("sends and moves the followed name into followedPeople", async () => {
    const user = await makeUser();
    await notifyNameMentionUpdates([record()], ["Telegram"], opts, new Date());
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.followedNames).not.toContain("Jean Dupont");
    expect(refreshed?.followedPeople.length).toBe(1);
  });

  it("restricts to provided userIds", async () => {
    const target = await makeUser();
    await makeUser();
    await notifyNameMentionUpdates([record()], ["Telegram"], opts, new Date(), [
      target._id
    ]);
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it("does not convert when the send fails", async () => {
    sendMessageSpy.mockResolvedValue(false);
    const user = await makeUser();
    await notifyNameMentionUpdates([record()], ["Telegram"], opts, new Date());
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.followedNames).toContain("Jean Dupont");
  });

  it("does not duplicate a people follow the user already has", async () => {
    const person = await People.create({ nom: "Dupont", prenom: "Jean" });
    const user = await makeUser({
      followedPeople: [{ peopleId: person._id, lastUpdate: new Date() }]
    });
    await notifyNameMentionUpdates([record()], ["Telegram"], opts, new Date());
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.followedPeople.length).toBe(1);
  });

  it("logs when the follow conversion modifies nothing", async () => {
    await makeUser();
    const spy = vi.spyOn(User, "updateOne").mockResolvedValue(ZERO_UPDATE);
    await notifyNameMentionUpdates([record()], ["Telegram"], opts, new Date());
    expect(logErrorSpy).toHaveBeenCalledWith(
      "Telegram",
      expect.stringContaining("No lastUpdate updated")
    );
    spy.mockRestore();
  });
});

describe("notifyNameMentionUpdates — WhatsApp re-engagement", () => {
  const waUser = () =>
    makeUser({
      chatId: "wa-" + Math.random().toString(36).slice(2),
      messageApp: "WhatsApp",
      waitingReengagement: false,
      lastEngagementAt: new Date()
    });

  it("stashes pending + sends a template when expired", async () => {
    const user = await waUser();
    await notifyNameMentionUpdates(
      [record()],
      ["WhatsApp"],
      opts,
      new Date(Date.now() + 25 * HOUR)
    );
    expect(templateSpy).toHaveBeenCalledTimes(1);
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.waitingReengagement).toBe(true);
    expect(refreshed?.pendingNotifications.length).toBe(1);
  });

  it("logs and aborts when the WhatsApp API is missing", async () => {
    await waUser();
    await notifyNameMentionUpdates(
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
    await notifyNameMentionUpdates(
      [record()],
      ["WhatsApp"],
      opts,
      new Date(Date.now() + 25 * HOUR)
    );
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.waitingReengagement).toBe(false);
  });

  it("logs a near-miss just past the edge", async () => {
    await waUser();
    await notifyNameMentionUpdates(
      [record()],
      ["WhatsApp"],
      opts,
      new Date(Date.now() + 24 * HOUR + 10 * 60 * 1000)
    );
    expect(logErrorSpy).toHaveBeenCalledWith(
      "WhatsApp",
      expect.stringContaining("near-miss")
    );
  });

  it("logs when waitingReengagement is not updated", async () => {
    await waUser();
    const spy = vi.spyOn(User, "updateOne").mockResolvedValue(ZERO_UPDATE);
    await notifyNameMentionUpdates(
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
    await notifyNameMentionUpdates(
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

describe("sendNameMentionUpdates", () => {
  const userInfo: ExtendedMiniUserInfo = {
    messageApp: "Telegram",
    chatId: "123",
    status: "active",
    hasAccount: true,
    waitingReengagement: false,
    lastEngagementAt: new Date()
  };

  it("returns true with no records", async () => {
    expect(await sendNameMentionUpdates(userInfo, new Map(), opts)).toBe(true);
  });

  it("sends a formatted update", async () => {
    const map = new Map([["Jean Dupont", [record()]]]);
    expect(await sendNameMentionUpdates(userInfo, map, opts)).toBe(true);
    expect(String(sendMessageSpy.mock.calls[0][1])).toContain("Jean Dupont");
  });

  it("logs and skips an empty record group", async () => {
    const map = new Map([["Jean Dupont", [] as JORFSearchItem[]]]);
    await sendNameMentionUpdates(userInfo, map, opts);
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it("renders a separator between multiple names", async () => {
    const map = new Map([
      ["Jean Dupont", [record()]],
      ["Paul Martin", [record({ nom: "Martin", prenom: "Paul" })]]
    ]);
    expect(await sendNameMentionUpdates(userInfo, map, opts)).toBe(true);
    expect(String(sendMessageSpy.mock.calls[0][1])).toContain("====");
  });

  it("returns false when the send fails", async () => {
    sendMessageSpy.mockResolvedValue(false);
    const map = new Map([["Jean Dupont", [record()]]]);
    expect(await sendNameMentionUpdates(userInfo, map, opts)).toBe(false);
  });
});

describe("updateFollowedNamesToFollowedPeople", () => {
  it("is a no-op when the user is not in the provided list", async () => {
    await expect(
      updateFollowedNamesToFollowedPeople(
        new mongoose.Types.ObjectId(),
        ["Jean Dupont"],
        new Map(),
        [],
        new Date(),
        "suffix",
        "Telegram",
        "direct"
      )
    ).resolves.toBeUndefined();
    expect(logErrorSpy).not.toHaveBeenCalled();
  });
});
