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
  notifyPeopleUpdates,
  sendPeopleUpdate
} from "../notifications/peopleNotifications.ts";
import type { ExternalMessageOptions } from "../entities/Session.ts";
import type { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import type { ExtendedMiniUserInfo } from "../entities/Session.ts";

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

const makePerson = (nom = "Dupont", prenom = "Jean") =>
  People.create({ nom, prenom });

const makeUser = (peopleId: mongoose.Types.ObjectId, over = {}) =>
  User.create({
    chatId: "p-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION,
    status: "active",
    lastEngagementAt: new Date(),
    followedPeople: [{ peopleId, lastUpdate: new Date("2020-01-01") }],
    ...over
  });

beforeEach(async () => {
  if (!mongoose.connection.db) throw new Error("no db");
  await mongoose.connection.db.dropDatabase();
  vi.clearAllMocks();
  sendMessageSpy.mockResolvedValue(true);
  templateSpy.mockResolvedValue(true);
});

describe("notifyPeopleUpdates — early exits", () => {
  it("returns when there are no records", async () => {
    await notifyPeopleUpdates([], ["Telegram"], opts, new Date());
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("returns when no People match", async () => {
    await notifyPeopleUpdates([record()], ["Telegram"], opts, new Date());
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("returns when no users follow the matched person", async () => {
    await makePerson();
    await notifyPeopleUpdates([record()], ["Telegram"], opts, new Date());
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("throws when userIds is an empty array", async () => {
    await makePerson();
    await expect(
      notifyPeopleUpdates([record()], ["Telegram"], opts, new Date(), [])
    ).rejects.toThrow("Empty userIds");
  });
});

describe("notifyPeopleUpdates — sends and advances lastUpdate", () => {
  it("sends to a following user and bumps followedPeople.lastUpdate", async () => {
    const person = await makePerson();
    const user = await makeUser(person._id);

    await notifyPeopleUpdates([record()], ["Telegram"], opts, new Date());

    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.followedPeople[0].lastUpdate.getTime()).toBeGreaterThan(
      new Date("2020-01-01").getTime()
    );
  });

  it("skips records older than the user's lastUpdate", async () => {
    const person = await makePerson();
    await makeUser(person._id, {
      followedPeople: [{ peopleId: person._id, lastUpdate: new Date() }]
    });

    await notifyPeopleUpdates(
      [record({ source_date: "2020-06-20" })],
      ["Telegram"],
      opts,
      new Date()
    );
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("restricts to the provided userIds", async () => {
    const person = await makePerson();
    const target = await makeUser(person._id);
    await makeUser(person._id); // other user, excluded

    await notifyPeopleUpdates([record()], ["Telegram"], opts, new Date(), [
      target._id
    ]);
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it("does not advance lastUpdate when the send fails", async () => {
    sendMessageSpy.mockResolvedValue(false);
    const person = await makePerson();
    const user = await makeUser(person._id);

    await notifyPeopleUpdates([record()], ["Telegram"], opts, new Date());
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.followedPeople[0].lastUpdate.getTime()).toBe(
      new Date("2020-01-01").getTime()
    );
  });
});

describe("notifyPeopleUpdates — WhatsApp re-engagement", () => {
  const waUser = (person: mongoose.Types.ObjectId) =>
    makeUser(person, {
      chatId: "wa-" + Math.random().toString(36).slice(2),
      messageApp: "WhatsApp",
      waitingReengagement: false,
      lastEngagementAt: new Date()
    });

  it("stashes pending notifications and sends a template when expired", async () => {
    const person = await makePerson();
    const user = await waUser(person._id);
    const windowNow = new Date(Date.now() + 25 * HOUR);

    await notifyPeopleUpdates([record()], ["WhatsApp"], opts, windowNow);

    expect(templateSpy).toHaveBeenCalledTimes(1);
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.waitingReengagement).toBe(true);
    expect(refreshed?.pendingNotifications.length).toBe(1);
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("logs and aborts when the WhatsApp API is missing", async () => {
    const person = await makePerson();
    await waUser(person._id);
    await notifyPeopleUpdates(
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
    const person = await makePerson();
    const user = await waUser(person._id);

    await notifyPeopleUpdates(
      [record()],
      ["WhatsApp"],
      opts,
      new Date(Date.now() + 25 * HOUR)
    );
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.waitingReengagement).toBe(false);
  });

  it("sends in-window when forceWHMessages is set", async () => {
    const person = await makePerson();
    await waUser(person._id);
    await notifyPeopleUpdates(
      [record()],
      ["WhatsApp"],
      opts,
      new Date(Date.now() + 25 * HOUR),
      undefined,
      true
    );
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    expect(templateSpy).not.toHaveBeenCalled();
  });

  it("logs a near-miss when expiry is just past the 24h edge", async () => {
    const person = await makePerson();
    await waUser(person._id);
    // 24h + 10min after engagement: expired but within the near-miss window.
    const windowNow = new Date(Date.now() + 24 * HOUR + 10 * 60 * 1000);
    await notifyPeopleUpdates([record()], ["WhatsApp"], opts, windowNow);
    expect(logErrorSpy).toHaveBeenCalledWith(
      "WhatsApp",
      expect.stringContaining("near-miss")
    );
  });

  it("logs when the waitingReengagement flag is not updated", async () => {
    const person = await makePerson();
    await waUser(person._id);
    const spy = vi.spyOn(User, "updateOne").mockResolvedValue(ZERO_UPDATE);
    await notifyPeopleUpdates(
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
});

describe("notifyPeopleUpdates — lastUpdate edge cases", () => {
  it("renders a separator and bumps lastUpdate for multiple followed people", async () => {
    const p1 = await makePerson("Dupont", "Jean");
    const p2 = await makePerson("Martin", "Paul");
    await makeUser(p1._id, {
      followedPeople: [
        { peopleId: p1._id, lastUpdate: new Date("2020-01-01") },
        { peopleId: p2._id, lastUpdate: new Date("2020-01-01") }
      ]
    });
    await notifyPeopleUpdates(
      [record(), record({ nom: "Martin", prenom: "Paul" })],
      ["Telegram"],
      opts,
      new Date()
    );
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    expect(String(sendMessageSpy.mock.calls[0][1])).toContain("Jean Dupont");
    expect(String(sendMessageSpy.mock.calls[0][1])).toContain("Paul Martin");
  });

  it("logs when no lastUpdate is modified after a successful send", async () => {
    const person = await makePerson();
    await makeUser(person._id);
    const spy = vi.spyOn(User, "updateOne").mockResolvedValueOnce(ZERO_UPDATE);
    await notifyPeopleUpdates([record()], ["Telegram"], opts, new Date());
    expect(logErrorSpy).toHaveBeenCalledWith(
      "Telegram",
      expect.stringContaining("No lastUpdate updated")
    );
    spy.mockRestore();
  });
});

describe("sendPeopleUpdate", () => {
  const userInfo: ExtendedMiniUserInfo = {
    messageApp: "Telegram",
    chatId: "123",
    status: "active",
    hasAccount: true,
    waitingReengagement: false,
    lastEngagementAt: new Date()
  };

  it("returns true with no records to send", async () => {
    expect(await sendPeopleUpdate(userInfo, new Map(), opts)).toBe(true);
  });

  it("formats and sends an update for one person", async () => {
    const map = new Map([["pid", [record()]]]);
    expect(await sendPeopleUpdate(userInfo, map, opts)).toBe(true);
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    expect(String(sendMessageSpy.mock.calls[0][1])).toContain("Jean Dupont");
  });

  it("logs and skips an empty record group", async () => {
    const map = new Map([["pid", [] as JORFSearchItem[]]]);
    await sendPeopleUpdate(userInfo, map, opts);
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it("returns false when the underlying send fails", async () => {
    sendMessageSpy.mockResolvedValue(false);
    const map = new Map([["pid", [record()]]]);
    expect(await sendPeopleUpdate(userInfo, map, opts)).toBe(false);
  });
});
