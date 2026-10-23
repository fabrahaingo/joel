import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const { logErrorSpy, callRefSpy, notifyAllSpy } = vi.hoisted(() => ({
  logErrorSpy: vi.fn(() => Promise.resolve()),
  callRefSpy: vi.fn(),
  notifyAllSpy: vi.fn(() => Promise.resolve([] as string[]))
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
import { JORFSEARCH_UNAVAILABLE_TEXT } from "../utils/jorfSearchHealth.ts";

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
    const session = makeSession(await User.findById(user._id));
    await triggerPendingNotifications(session);

    const [reference, messageApp, options] = callRefSpy.mock
      .calls[0] as unknown as [string, string, { onRetry: () => void }];
    expect([reference, messageApp]).toEqual(["R1", "Telegram"]);
    // A slow reference lookup keeps the typing indicator up.
    options.onRetry();
    expect(session.sendTypingAction).toHaveBeenCalled();
    expect(notifyAllSpy).toHaveBeenCalled();
    // Scoped to the triggering user and forced past the WH window: this is an
    // on-demand delivery, not a broadcast.
    const notifyArgs = notifyAllSpy.mock.calls[0] as unknown[];
    expect((notifyArgs[5] as { toString(): string }[])[0].toString()).toBe(
      user._id.toString()
    );
    expect(notifyArgs[6]).toBe(true);
    // Publications are keyed by `id`; a lookup on any other field returns
    // nothing and the pending pile is cleared without delivering them.
    expect((notifyArgs[1] as { id: string }[]).map((p) => p.id)).toEqual([
      "M1"
    ]);
    const refreshed = await User.findById(user._id);
    expect(refreshed?.pendingNotifications.length).toBe(0);
    expect(refreshed?.waitingReengagement).toBe(false);
  });

  it("delivers a pending alert-string notification on its own", async () => {
    await Publication.create({
      id: "M2",
      date: "2026-06-21",
      date_obj: new Date(),
      title: "Arrete",
      tags: {}
    });
    const user = await userWithPending([
      {
        notificationType: "meta",
        source_ids: ["M2"],
        insertDate: new Date(),
        items_nb: 1
      }
    ]);

    await triggerPendingNotifications(
      makeSession(await User.findById(user._id))
    );

    const notifyArgs = notifyAllSpy.mock.calls[0] as unknown[];
    expect((notifyArgs[1] as { id: string }[]).map((p) => p.id)).toEqual([
      "M2"
    ]);
  });

  it("fetches a reference repeated across batches only once", async () => {
    const user = await userWithPending([
      {
        notificationType: "people",
        source_ids: ["R1"],
        insertDate: new Date(),
        items_nb: 1
      },
      {
        notificationType: "organisation",
        source_ids: ["R1"],
        insertDate: new Date(),
        items_nb: 1
      }
    ]);

    await triggerPendingNotifications(
      makeSession(await User.findById(user._id))
    );

    expect(callRefSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the pile and tells the user when a ref cannot be fetched", async () => {
    callRefSpy.mockImplementation((ref: string) =>
      Promise.resolve(ref === "R2" ? null : [item()])
    );
    const user = await userWithPending([
      {
        notificationType: "function",
        source_ids: ["R1", "R2"],
        insertDate: new Date(),
        items_nb: 2
      }
    ]);
    await triggerPendingNotifications(
      makeSession(await User.findById(user._id))
    );

    expect(notifyAllSpy).not.toHaveBeenCalled();
    expect(String(sendSpy.mock.calls.at(-1)?.[0])).toContain(
      JORFSEARCH_UNAVAILABLE_TEXT
    );
    const after = await User.findById(user._id);
    expect(after?.pendingNotifications).toHaveLength(1);
    // callJORFSearchReference reports the failure; one alert per ref is noise.
    expect(logErrorSpy).not.toHaveBeenCalled();
  });

  it("stops fetching once a ref has failed", async () => {
    callRefSpy.mockResolvedValue(null);
    const user = await userWithPending([
      {
        notificationType: "function",
        source_ids: ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"],
        insertDate: new Date(),
        items_nb: 8
      }
    ]);
    await triggerPendingNotifications(
      makeSession(await User.findById(user._id))
    );

    // Only the first concurrent batch (FETCH_CONCURRENCY = 4) was in flight
    // when the failure landed.
    expect(callRefSpy).toHaveBeenCalledTimes(4);
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

  it("keeps the pending pile when a handler is reported as failed", async () => {
    const user = await userWithPending([
      {
        notificationType: "organisation",
        source_ids: ["R1"],
        insertDate: new Date(),
        items_nb: 1
      }
    ]);
    notifyAllSpy.mockResolvedValueOnce(["organisations"]);

    await triggerPendingNotifications(
      makeSession(await User.findById(user._id))
    );

    const refreshed = await User.findById(user._id);
    expect(refreshed?.pendingNotifications.length).toBe(1);
    expect(logErrorSpy).toHaveBeenCalled();
  });
});
