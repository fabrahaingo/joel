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
import {
  notifyAlertStringUpdates,
  sendAlertStringUpdate
} from "../notifications/alertStringNotifications.ts";
import type {
  ExternalMessageOptions,
  ExtendedMiniUserInfo
} from "../entities/Session.ts";
import type { JORFSearchPublication } from "../entities/JORFSearchResponseMeta.ts";

const HOUR = 60 * 60 * 1000;
const ALERT = "budget";
const opts = { whatsAppAPI: {} as unknown } as ExternalMessageOptions;

const pub = (
  over: Partial<JORFSearchPublication> = {}
): JORFSearchPublication =>
  ({
    id: "JORFTEXT0001",
    date: "2026-06-20",
    title: "Décret budget 2026",
    tags: {},
    ...over
  }) as JORFSearchPublication;

const makeUser = (over = {}) =>
  User.create({
    chatId: "a-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION,
    status: "active",
    lastEngagementAt: new Date(),
    followedMeta: [{ alertString: ALERT, lastUpdate: new Date("2020-01-01") }],
    ...over
  });

beforeEach(async () => {
  if (!mongoose.connection.db) throw new Error("no db");
  await mongoose.connection.db.dropDatabase();
  vi.clearAllMocks();
  sendMessageSpy.mockResolvedValue(true);
  templateSpy.mockResolvedValue(true);
});

describe("notifyAlertStringUpdates — early exits", () => {
  it("returns when there are no meta records", async () => {
    await notifyAlertStringUpdates([], ["Telegram"], opts, new Date());
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("returns when no user follows alerts", async () => {
    await notifyAlertStringUpdates([pub()], ["Telegram"], opts, new Date());
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("throws on empty userIds", async () => {
    await expect(
      notifyAlertStringUpdates([pub()], ["Telegram"], opts, new Date(), [])
    ).rejects.toThrow("Empty userIds");
  });

  it("returns when the alert does not match any title", async () => {
    await makeUser({
      followedMeta: [
        { alertString: "zzznope", lastUpdate: new Date("2020-01-01") }
      ]
    });
    await notifyAlertStringUpdates([pub()], ["Telegram"], opts, new Date());
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });
});

describe("notifyAlertStringUpdates — send + lastUpdate", () => {
  it("sends a matched alert and bumps lastUpdate", async () => {
    const user = await makeUser();
    await notifyAlertStringUpdates([pub()], ["Telegram"], opts, new Date());
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.followedMeta[0].lastUpdate.getTime()).toBeGreaterThan(
      new Date("2020-01-01").getTime()
    );
  });

  it("skips a publication older than lastUpdate", async () => {
    await makeUser({
      followedMeta: [{ alertString: ALERT, lastUpdate: new Date() }]
    });
    await notifyAlertStringUpdates(
      [pub({ date: "2020-01-02" })],
      ["Telegram"],
      opts,
      new Date()
    );
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("restricts to provided userIds", async () => {
    const target = await makeUser();
    await makeUser();
    await notifyAlertStringUpdates([pub()], ["Telegram"], opts, new Date(), [
      target._id
    ]);
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it("skips a followedMeta entry with a blank alertString", async () => {
    // Raw insert to bypass schema validation for the blank entry.
    await User.collection.insertOne({
      chatId: "blank-" + Math.random().toString(36).slice(2),
      messageApp: "Telegram",
      schemaVersion: USER_SCHEMA_VERSION,
      status: "active",
      lastEngagementAt: new Date(),
      followedMeta: [
        { alertString: "", lastUpdate: new Date("2020-01-01") },
        { alertString: ALERT, lastUpdate: new Date("2020-01-01") }
      ]
    });
    await notifyAlertStringUpdates([pub()], ["Telegram"], opts, new Date());
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it("does not bump lastUpdate when the send fails", async () => {
    sendMessageSpy.mockResolvedValue(false);
    const user = await makeUser();
    await notifyAlertStringUpdates([pub()], ["Telegram"], opts, new Date());
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.followedMeta[0].lastUpdate.getTime()).toBe(
      new Date("2020-01-01").getTime()
    );
  });

  it("logs when no lastUpdate is modified after a send", async () => {
    await makeUser();
    const spy = vi.spyOn(User, "updateOne").mockResolvedValue(ZERO_UPDATE);
    await notifyAlertStringUpdates([pub()], ["Telegram"], opts, new Date());
    expect(logErrorSpy).toHaveBeenCalledWith(
      "Telegram",
      expect.stringContaining("No lastUpdate updated")
    );
    spy.mockRestore();
  });
});

describe("notifyAlertStringUpdates — WhatsApp re-engagement", () => {
  const waUser = () =>
    makeUser({
      chatId: "wa-" + Math.random().toString(36).slice(2),
      messageApp: "WhatsApp",
      waitingReengagement: false,
      lastEngagementAt: new Date()
    });

  it("stashes pending + sends a template when expired", async () => {
    const user = await waUser();
    await notifyAlertStringUpdates(
      [pub()],
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
    await notifyAlertStringUpdates(
      [pub()],
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
    await notifyAlertStringUpdates(
      [pub()],
      ["WhatsApp"],
      opts,
      new Date(Date.now() + 25 * HOUR)
    );
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.waitingReengagement).toBe(false);
  });

  it("logs a near-miss just past the edge", async () => {
    await waUser();
    await notifyAlertStringUpdates(
      [pub()],
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
    await notifyAlertStringUpdates(
      [pub()],
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
    await notifyAlertStringUpdates(
      [pub()],
      ["WhatsApp"],
      opts,
      new Date(Date.now() + 25 * HOUR),
      undefined,
      true
    );
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });
});

describe("sendAlertStringUpdate", () => {
  const userInfo: ExtendedMiniUserInfo = {
    messageApp: "Telegram",
    chatId: "123",
    status: "active",
    hasAccount: true,
    waitingReengagement: false,
    lastEngagementAt: new Date()
  };

  it("returns true with no records", async () => {
    expect(await sendAlertStringUpdate(userInfo, new Map(), opts)).toBe(true);
  });

  it("formats a matched alert with a date and link", async () => {
    const map = new Map([[ALERT, [pub()]]]);
    expect(await sendAlertStringUpdate(userInfo, map, opts)).toBe(true);
    const msg = String(sendMessageSpy.mock.calls[0][1]);
    expect(msg).toContain(ALERT);
    expect(msg).toContain("🗓️");
    expect(msg).toContain("Lien vers le texte");
  });

  it("omits the date line when the publication has no date", async () => {
    const map = new Map([
      [ALERT, [pub({ date: undefined as unknown as string })]]
    ]);
    await sendAlertStringUpdate(userInfo, map, opts);
    expect(String(sendMessageSpy.mock.calls[0][1])).not.toContain("🗓️");
  });

  it("skips an empty record group", async () => {
    const map = new Map([[ALERT, [] as JORFSearchPublication[]]]);
    expect(await sendAlertStringUpdate(userInfo, map, opts)).toBe(true);
  });

  it("renders a separator between multiple alerts", async () => {
    const map = new Map([
      [ALERT, [pub()]],
      ["impots", [pub({ id: "JORFTEXT0002", title: "Loi impots" })]]
    ]);
    expect(await sendAlertStringUpdate(userInfo, map, opts)).toBe(true);
    expect(String(sendMessageSpy.mock.calls[0][1])).toContain("====");
  });

  it("uses a plain link for WhatsApp", async () => {
    const map = new Map([[ALERT, [pub()]]]);
    await sendAlertStringUpdate(
      { ...userInfo, messageApp: "WhatsApp" },
      map,
      opts
    );
    const msg = String(sendMessageSpy.mock.calls[0][1]);
    expect(msg).toContain("🔗 https://bodata");
  });

  it("returns false when the send fails", async () => {
    sendMessageSpy.mockResolvedValue(false);
    const map = new Map([[ALERT, [pub()]]]);
    expect(await sendAlertStringUpdate(userInfo, map, opts)).toBe(false);
  });
});
