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
import Organisation from "../models/Organisation.ts";
import {
  notifyOrganisationsUpdates,
  sendOrganisationUpdate
} from "../notifications/organisationNotifications.ts";
import type {
  ExternalMessageOptions,
  ExtendedMiniUserInfo
} from "../entities/Session.ts";
import type { JORFSearchItem } from "../entities/JORFSearchResponse.ts";

const HOUR = 60 * 60 * 1000;
const WID = "Q123";
const opts = { whatsAppAPI: {} as unknown } as ExternalMessageOptions;

const record = (over: Partial<JORFSearchItem> = {}): JORFSearchItem => ({
  nom: "Dupont",
  prenom: "Jean",
  source_id: "JORFTEXT0001",
  source_date: "2026-06-20",
  source_name: "JORF",
  type_ordre: "nomination",
  organisations: [{ nom: "Conseil", wikidata_id: WID }],
  ...over
});

const makeOrg = (wikidataId = WID, nom = "Conseil") =>
  Organisation.create({ wikidataId, nom });

const makeUser = (wikidataId = WID, over = {}) =>
  User.create({
    chatId: "o-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION,
    status: "active",
    lastEngagementAt: new Date(),
    followedOrganisations: [{ wikidataId, lastUpdate: new Date("2020-01-01") }],
    ...over
  });

beforeEach(async () => {
  if (!mongoose.connection.db) throw new Error("no db");
  await mongoose.connection.db.dropDatabase();
  vi.clearAllMocks();
  sendMessageSpy.mockResolvedValue(true);
  templateSpy.mockResolvedValue(true);
});

describe("notifyOrganisationsUpdates — early exits", () => {
  it("returns when records carry no organisation wikidata ids", async () => {
    await notifyOrganisationsUpdates(
      [record({ organisations: [] })],
      ["Telegram"],
      opts,
      new Date()
    );
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("returns when no organisation is known in the db", async () => {
    await notifyOrganisationsUpdates(
      [record()],
      ["Telegram"],
      opts,
      new Date()
    );
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("returns when no user follows the organisation", async () => {
    await makeOrg();
    await notifyOrganisationsUpdates(
      [record()],
      ["Telegram"],
      opts,
      new Date()
    );
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("throws on empty userIds", async () => {
    await makeOrg();
    await expect(
      notifyOrganisationsUpdates([record()], ["Telegram"], opts, new Date(), [])
    ).rejects.toThrow("Empty userIds");
  });
});

describe("notifyOrganisationsUpdates — send + lastUpdate", () => {
  it("sends and bumps lastUpdate", async () => {
    await makeOrg();
    const user = await makeUser();
    await notifyOrganisationsUpdates(
      [record()],
      ["Telegram"],
      opts,
      new Date()
    );
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    const refreshed = await User.findById(user._id).lean();
    expect(
      refreshed?.followedOrganisations[0].lastUpdate.getTime()
    ).toBeGreaterThan(new Date("2020-01-01").getTime());
  });

  it("skips records older than lastUpdate", async () => {
    await makeOrg();
    await makeUser(WID, {
      followedOrganisations: [{ wikidataId: WID, lastUpdate: new Date() }]
    });
    await notifyOrganisationsUpdates(
      [record({ source_date: "2020-06-20" })],
      ["Telegram"],
      opts,
      new Date()
    );
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("restricts to provided userIds", async () => {
    await makeOrg();
    const target = await makeUser();
    await makeUser();
    await notifyOrganisationsUpdates(
      [record()],
      ["Telegram"],
      opts,
      new Date(),
      [target._id]
    );
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it("does not bump lastUpdate when the send fails", async () => {
    sendMessageSpy.mockResolvedValue(false);
    await makeOrg();
    const user = await makeUser();
    await notifyOrganisationsUpdates(
      [record()],
      ["Telegram"],
      opts,
      new Date()
    );
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.followedOrganisations[0].lastUpdate.getTime()).toBe(
      new Date("2020-01-01").getTime()
    );
  });

  it("logs when no lastUpdate modified after a successful send", async () => {
    await makeOrg();
    await makeUser();
    const spy = vi.spyOn(User, "updateOne").mockResolvedValueOnce(ZERO_UPDATE);
    await notifyOrganisationsUpdates(
      [record()],
      ["Telegram"],
      opts,
      new Date()
    );
    expect(logErrorSpy).toHaveBeenCalledWith(
      "Telegram",
      expect.stringContaining("No lastUpdate updated")
    );
    spy.mockRestore();
  });
});

describe("notifyOrganisationsUpdates — WhatsApp re-engagement", () => {
  const waUser = () =>
    makeUser(WID, {
      chatId: "wa-" + Math.random().toString(36).slice(2),
      messageApp: "WhatsApp",
      waitingReengagement: false,
      lastEngagementAt: new Date()
    });

  it("stashes pending + sends a template when expired", async () => {
    await makeOrg();
    const user = await waUser();
    await notifyOrganisationsUpdates(
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
    await makeOrg();
    await waUser();
    await notifyOrganisationsUpdates(
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
    await makeOrg();
    const user = await waUser();
    await notifyOrganisationsUpdates(
      [record()],
      ["WhatsApp"],
      opts,
      new Date(Date.now() + 25 * HOUR)
    );
    const refreshed = await User.findById(user._id).lean();
    expect(refreshed?.waitingReengagement).toBe(false);
  });

  it("logs a near-miss just past the edge", async () => {
    await makeOrg();
    await waUser();
    await notifyOrganisationsUpdates(
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
    await makeOrg();
    await waUser();
    const spy = vi.spyOn(User, "updateOne").mockResolvedValue(ZERO_UPDATE);
    await notifyOrganisationsUpdates(
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
    await makeOrg();
    await waUser();
    await notifyOrganisationsUpdates(
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

describe("sendOrganisationUpdate", () => {
  const userInfo: ExtendedMiniUserInfo = {
    messageApp: "Telegram",
    chatId: "123",
    status: "active",
    hasAccount: true,
    waitingReengagement: false,
    lastEngagementAt: new Date()
  };
  const names = new Map([[WID, "Conseil"]]);

  it("returns true with no records", async () => {
    expect(await sendOrganisationUpdate(userInfo, new Map(), names, opts)).toBe(
      true
    );
  });

  it("sends a formatted update", async () => {
    const map = new Map([[WID, [record()]]]);
    expect(await sendOrganisationUpdate(userInfo, map, names, opts)).toBe(true);
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    expect(String(sendMessageSpy.mock.calls[0][1])).toContain("Conseil");
  });

  it("logs and skips an organisation with an unknown name", async () => {
    const map = new Map([[WID, [record()]]]);
    await sendOrganisationUpdate(userInfo, map, new Map(), opts);
    expect(logErrorSpy).toHaveBeenCalledWith(
      "Telegram",
      expect.stringContaining("Unable to find the name")
    );
  });

  it("logs and skips an empty record group", async () => {
    const map = new Map([[WID, [] as JORFSearchItem[]]]);
    await sendOrganisationUpdate(userInfo, map, names, opts);
    expect(logErrorSpy).toHaveBeenCalledWith(
      "Telegram",
      expect.stringContaining("no records")
    );
  });

  it("renders a separator between multiple organisations", async () => {
    const map = new Map([
      [WID, [record()]],
      [
        "Q999",
        [record({ organisations: [{ nom: "Autre", wikidata_id: "Q999" }] })]
      ]
    ]);
    const names2 = new Map([
      [WID, "Conseil"],
      ["Q999", "Autre"]
    ]);
    expect(await sendOrganisationUpdate(userInfo, map, names2, opts)).toBe(
      true
    );
    expect(String(sendMessageSpy.mock.calls[0][1])).toContain("====");
  });

  it("renders a sub-group separator across multiple source references", async () => {
    const map = new Map([
      [
        WID,
        [
          record({ source_id: "JORFTEXT0001", source_date: "2026-06-20" }),
          record({ source_id: "JORFTEXT0002", source_date: "2026-06-21" })
        ]
      ]
    ]);
    expect(await sendOrganisationUpdate(userInfo, map, names, opts)).toBe(true);
    expect(String(sendMessageSpy.mock.calls[0][1])).toContain("----");
  });

  it("returns false when the send fails", async () => {
    sendMessageSpy.mockResolvedValue(false);
    const map = new Map([[WID, [record()]]]);
    expect(await sendOrganisationUpdate(userInfo, map, names, opts)).toBe(
      false
    );
  });
});
