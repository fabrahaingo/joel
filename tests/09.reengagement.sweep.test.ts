import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

// Spy for the template sender so no real WhatsApp API / cooldown runs.
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

vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn() }
}));

import User, { USER_SCHEMA_VERSION } from "../models/User.ts";
import type { ExternalMessageOptions } from "../entities/Session.ts";
import { runReengagementReminderSweep } from "../notifications/reengagementReminderSweep.ts";
import {
  FINAL_NOTIFICATION_TEMPLATE,
  MAX_REENGAGEMENT_REMINDERS,
  NOTIFICATION_TEMPLATE
} from "../entities/WhatsAppSession.ts";

const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

const fakeOptions = {
  whatsAppAPI: {} as unknown
} as ExternalMessageOptions;

let counter = 0;
const createWAUser = (overrides: Record<string, unknown> = {}) =>
  User.create({
    chatId: `wh-${String(counter++)}`,
    messageApp: "WhatsApp",
    schemaVersion: USER_SCHEMA_VERSION,
    status: "active",
    waitingReengagement: true,
    lastEngagementAt: new Date(Date.now() - EIGHT_DAYS_MS),
    pendingNotifications: [
      {
        notificationType: "function",
        source_ids: ["JORFTEXT000001"],
        insertDate: new Date(),
        items_nb: 1
      }
    ],
    ...overrides
  });

// chatIds passed to the (mocked) template sender
const sentChatIds = (): string[] =>
  sendSpy.mock.calls.map((c) => (c[1] as { chatId: string }).chatId);

describe("runReengagementReminderSweep", () => {
  beforeEach(async () => {
    if (!mongoose.connection.db)
      throw new Error("MongoDB connection not established");
    await mongoose.connection.db.dropDatabase();
    sendSpy.mockReset();
    sendSpy.mockResolvedValue(true);
    counter = 0;
  });

  it("sends only to due users", async () => {
    const due = await createWAUser();
    await createWAUser({ waitingReengagement: false }); // not waiting
    await createWAUser({ pendingNotifications: [] }); // nothing pending
    await createWAUser({ status: "blocked" }); // blocked
    await createWAUser({ lastReengagementSentAt: new Date() }); // reminded just now
    await createWAUser({
      reengagementReminderCount: MAX_REENGAGEMENT_REMINDERS
    }); // cap reached

    await runReengagementReminderSweep(fakeOptions);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sentChatIds()).toEqual([due.chatId]);
  });

  it("includes users last reminded over a week ago", async () => {
    const due = await createWAUser({
      lastReengagementSentAt: new Date(Date.now() - EIGHT_DAYS_MS),
      reengagementReminderCount: 3
    });

    await runReengagementReminderSweep(fakeOptions);

    expect(sentChatIds()).toEqual([due.chatId]);
  });

  it("uses the final template on the last allowed reminder", async () => {
    await createWAUser({
      reengagementReminderCount: MAX_REENGAGEMENT_REMINDERS - 1
    });

    await runReengagementReminderSweep(fakeOptions);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    // 5th positional arg is templateName
    expect(sendSpy.mock.calls[0][4]).toBe(FINAL_NOTIFICATION_TEMPLATE);
  });

  it("uses the standard template before the last reminder", async () => {
    await createWAUser({ reengagementReminderCount: 0 });

    await runReengagementReminderSweep(fakeOptions);

    expect(sendSpy.mock.calls[0][4]).toBe(NOTIFICATION_TEMPLATE);
  });

  it("does nothing when the WhatsApp client is missing", async () => {
    await createWAUser();

    await runReengagementReminderSweep({});

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("continues the sweep when one send throws", async () => {
    await createWAUser();
    await createWAUser();
    sendSpy.mockRejectedValueOnce(new Error("boom"));

    await runReengagementReminderSweep(fakeOptions);

    // Both users attempted despite the first throwing
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });
});
