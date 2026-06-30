import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const { logErrorSpy, callRefSpy, notifyAllSpy } = vi.hoisted(() => ({
  logErrorSpy: vi.fn(() => Promise.resolve()),
  callRefSpy: vi.fn(),
  notifyAllSpy: vi.fn(() => Promise.resolve())
}));

vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn(() => Promise.resolve()) }
}));
vi.mock("../utils/JORFSearch.utils.ts", async (importActual) => {
  const actual =
    await importActual<typeof import("../utils/JORFSearch.utils.ts")>();
  return { ...actual, callJORFSearchReference: callRefSpy };
});
vi.mock("../notifications/runNotificationProcess.ts", () => ({
  notifyAllFollows: notifyAllSpy
}));

import User, { USER_SCHEMA_VERSION } from "../models/User.ts";
import { Publication } from "../models/Publication.ts";
import { triggerPendingNotifications } from "../commands/triggerPendingNotifications.ts";
import type { ISession, IUser } from "../types.ts";
import type { JORFSearchItem } from "../entities/JORFSearchResponse.ts";

const sendSpy = vi.fn(() => Promise.resolve(true));
const makeSession = (user: IUser | null): ISession =>
  ({
    messageApp: "Telegram",
    chatId: "tp-" + Math.random().toString(36).slice(2),
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
  }) as unknown as ISession;

const item = (): JORFSearchItem => ({
  nom: "Dupont",
  prenom: "Jean",
  source_id: "R1",
  source_date: "2026-06-20",
  source_name: "JORF",
  type_ordre: "nomination",
  organisations: []
});

const userWithPending = (pending: IUser["pendingNotifications"]) =>
  User.create({
    chatId: "tpu-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION,
    status: "active",
    waitingReengagement: true,
    pendingNotifications: pending
  });

beforeEach(async () => {
  if (!mongoose.connection.db) throw new Error("no db");
  await mongoose.connection.db.dropDatabase();
  vi.clearAllMocks();
  sendSpy.mockResolvedValue(true);
  callRefSpy.mockResolvedValue([item()]);
});

describe("triggerPendingNotifications", () => {
  it("logs and asks for a follow when there is no user", async () => {
    await triggerPendingNotifications(makeSession(null));
    expect(logErrorSpy).toHaveBeenCalled();
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "ajouter un suivi"
    );
  });

  it("reports when nothing is pending", async () => {
    const user = await userWithPending([]);
    await triggerPendingNotifications(
      makeSession(await User.findById(user._id))
    );
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      "Aucune notification"
    );
  });

  it("fetches refs, dispatches and clears the pending pile", async () => {
    await Publication.create({
      id: "M1",
      source_id: "M1",
      date: "2026-06-20",
      date_obj: new Date(),
      title: "Decret",
      tags: {}
    });
    const older = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const user = await userWithPending([
      {
        notificationType: "people",
        source_ids: ["R1"],
        insertDate: new Date(),
        items_nb: 2
      },
      {
        notificationType: "name",
        source_ids: ["R3"],
        insertDate: older,
        items_nb: 1
      },
      {
        notificationType: "meta",
        source_ids: ["M1"],
        insertDate: new Date(),
        items_nb: 1
      }
    ]);
    await triggerPendingNotifications(
      makeSession(await User.findById(user._id))
    );

    expect(callRefSpy).toHaveBeenCalledWith("R1", "Telegram");
    expect(notifyAllSpy).toHaveBeenCalled();
    const refreshed = await User.findById(user._id);
    expect(refreshed?.pendingNotifications.length).toBe(0);
    expect(refreshed?.waitingReengagement).toBe(false);
  });

  it("logs when a ref fetch returns nothing", async () => {
    callRefSpy.mockResolvedValue(null);
    const user = await userWithPending([
      {
        notificationType: "function",
        source_ids: ["R1"],
        insertDate: new Date(),
        items_nb: 1
      }
    ]);
    await triggerPendingNotifications(
      makeSession(await User.findById(user._id))
    );
    expect(logErrorSpy).toHaveBeenCalledWith(
      "Telegram",
      expect.stringContaining("fetching item")
    );
  });

  it("logs on an unexpected error", async () => {
    callRefSpy.mockRejectedValue(new Error("boom"));
    const user = await userWithPending([
      {
        notificationType: "organisation",
        source_ids: ["R1"],
        insertDate: new Date(),
        items_nb: 1
      }
    ]);
    notifyAllSpy.mockRejectedValueOnce(new Error("dispatch failed"));
    await triggerPendingNotifications(
      makeSession(await User.findById(user._id))
    );
    expect(logErrorSpy).toHaveBeenCalled();
  });
});
