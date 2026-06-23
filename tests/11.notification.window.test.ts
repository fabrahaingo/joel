import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

// Spy the template sender so no real WhatsApp API / cooldown runs.
const { sendSpy } = vi.hoisted(() => ({ sendSpy: vi.fn() }));

vi.mock("../entities/WhatsAppSession.ts", async (importActual) => {
  const actual =
    await importActual<typeof import("../entities/WhatsAppSession.ts")>();
  return {
    ...actual,
    sendWhatsAppTemplate: (...args: unknown[]): Promise<boolean> =>
      sendSpy(...args) as Promise<boolean>
  };
});

const { umamiLogAsync } = vi.hoisted(() => ({ umamiLogAsync: vi.fn() }));
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: umamiLogAsync }
}));

import User, { USER_SCHEMA_VERSION } from "../models/User.ts";
import type { ExternalMessageOptions } from "../entities/Session.ts";
import type { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import { notifyFunctionTagsUpdates } from "../notifications/functionTagNotifications.ts";

const TAG = FunctionTags.Ambassadeur; // "ambassadeur"
const HOUR_MS = 60 * 60 * 1000;

const fakeOptions = {
  whatsAppAPI: {} as unknown
} as ExternalMessageOptions;

// A record carrying the followed function tag; only source_id / source_date /
// the tag key are read on the expired path.
const tagRecord = (): JORFSearchItem =>
  ({
    [TAG]: "ok",
    source_id: "JORFTEXT000001",
    source_date: "2026-06-20"
  }) as unknown as JORFSearchItem;

// Fresh WhatsApp user: by wall-clock they are well inside their 24h window, so
// any expiry can only come from the injected windowNow.
const createFreshWAUser = (lastEngagementAt: Date) =>
  User.create({
    chatId: "wh-window-" + Math.random().toString(36).slice(2),
    messageApp: "WhatsApp",
    schemaVersion: USER_SCHEMA_VERSION,
    status: "active",
    waitingReengagement: false,
    lastEngagementAt,
    followedFunctions: [
      { functionTag: TAG, lastUpdate: new Date("2020-01-01") }
    ]
  });

const nearMissLogged = (): boolean =>
  umamiLogAsync.mock.calls.some(
    (c) => (c[0] as { event?: string }).event === "/wh-reengagement-near-miss"
  );

describe("notifyFunctionTagsUpdates — windowNow drives the 24h decision", () => {
  beforeEach(async () => {
    if (!mongoose.connection.db)
      throw new Error("MongoDB connection not established");
    await mongoose.connection.db.dropDatabase();
    sendSpy.mockReset();
    sendSpy.mockResolvedValue(true);
    umamiLogAsync.mockReset();
    umamiLogAsync.mockResolvedValue(undefined);
  });

  it("expires a wall-clock-in-window user when windowNow is past the edge", async () => {
    const lastEngagementAt = new Date(); // now -> in window by wall clock
    const user = await createFreshWAUser(lastEngagementAt);

    // 25h after engagement: only honoring windowNow (not Date.now()) makes this expired.
    const windowNow = new Date(lastEngagementAt.getTime() + 25 * HOUR_MS);

    await notifyFunctionTagsUpdates(
      [tagRecord()],
      ["WhatsApp"],
      fakeOptions,
      windowNow
    );

    // Re-engagement template fired -> the expiry decision used windowNow.
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const refreshed = await User.findById(user._id).lean();
    if (refreshed == null) throw new Error("user not found");
    expect(refreshed.waitingReengagement).toBe(true);
    // Updates were stashed as pending instead of being sent in-window.
    expect(refreshed.pendingNotifications.length).toBe(1);
    expect(refreshed.pendingNotifications[0].notificationType).toBe("function");
    expect(refreshed.pendingNotifications[0].source_ids).toContain(
      "JORFTEXT000001"
    );
  });

  it("logs a near-miss when windowNow is just past the edge (within the near-miss window)", async () => {
    const lastEngagementAt = new Date();
    await createFreshWAUser(lastEngagementAt);

    // 24h10m: expired, but inside the 24h25m near-miss window.
    const windowNow = new Date(
      lastEngagementAt.getTime() + 24 * HOUR_MS + 10 * 60 * 1000
    );

    await notifyFunctionTagsUpdates(
      [tagRecord()],
      ["WhatsApp"],
      fakeOptions,
      windowNow
    );

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(nearMissLogged()).toBe(true);
  });

  it("does not log a near-miss when windowNow is far past the edge", async () => {
    const lastEngagementAt = new Date();
    await createFreshWAUser(lastEngagementAt);

    // 30h: expired and well beyond the near-miss window.
    const windowNow = new Date(lastEngagementAt.getTime() + 30 * HOUR_MS);

    await notifyFunctionTagsUpdates(
      [tagRecord()],
      ["WhatsApp"],
      fakeOptions,
      windowNow
    );

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(nearMissLogged()).toBe(false);
  });
});
