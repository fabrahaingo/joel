import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  logErrorSpy: vi.fn(() => Promise.resolve()),
  getRecords: vi.fn(() => Promise.resolve([] as unknown[])),
  getMeta: vi.fn(() => Promise.resolve([] as unknown[])),
  refreshBlocked: vi.fn(() => Promise.resolve()),
  reengagement: vi.fn(() => Promise.resolve()),
  notifyFn: vi.fn(() => Promise.resolve()),
  notifyOrg: vi.fn(() => Promise.resolve()),
  notifyPeople: vi.fn(() => Promise.resolve()),
  notifyName: vi.fn(() => Promise.resolve()),
  notifyAlert: vi.fn(() => Promise.resolve())
}));

vi.mock("mongoose", () => {
  const m = {
    connection: { readyState: 0 },
    Types: {
      ObjectId: class {
        readonly id = "stub";
      }
    },
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve())
  };
  return { default: m, ...m };
});
vi.mock("../db.ts", () => ({ mongodbConnect: vi.fn(() => Promise.resolve()) }));
vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn(() => Promise.resolve()) }
}));
vi.mock("../utils/debugLogger.ts", () => ({ logError: h.logErrorSpy }));
vi.mock("../utils/JORFSearch.utils.ts", () => ({
  getJORFRecordsFromDate: h.getRecords,
  getJORFMetaRecordsFromDate: h.getMeta
}));
vi.mock("../entities/TelegramSession.ts", () => ({
  refreshTelegramBlockedUsers: h.refreshBlocked
}));
vi.mock("../notifications/reengagementReminderSweep.ts", () => ({
  runReengagementReminderSweep: h.reengagement
}));
vi.mock("../notifications/functionTagNotifications.ts", () => ({
  notifyFunctionTagsUpdates: h.notifyFn
}));
vi.mock("../notifications/organisationNotifications.ts", () => ({
  notifyOrganisationsUpdates: h.notifyOrg
}));
vi.mock("../notifications/peopleNotifications.ts", () => ({
  notifyPeopleUpdates: h.notifyPeople
}));
vi.mock("../notifications/nameNotifications.ts", () => ({
  notifyNameMentionUpdates: h.notifyName
}));
vi.mock("../notifications/alertStringNotifications.ts", () => ({
  notifyAlertStringUpdates: h.notifyAlert
}));

import {
  runNotificationProcess,
  notifyAllFollows
} from "../notifications/runNotificationProcess.ts";
import type { WhatsAppAPI } from "whatsapp-api-js/middleware/express";

beforeEach(() => {
  vi.clearAllMocks();
  h.getRecords.mockResolvedValue([]);
  h.getMeta.mockResolvedValue([]);
});

describe("runNotificationProcess — missing-client guards", () => {
  it.each([["Matrix"], ["Telegram"], ["Signal"], ["WhatsApp"]] as [
    "Matrix" | "Telegram" | "Signal" | "WhatsApp"
  ][])("skips and logs when the %s client is missing", async (app) => {
    await runNotificationProcess([app], {});
    expect(h.logErrorSpy).toHaveBeenCalled();
    // Guard returns before fetching any JORF records.
    expect(h.getRecords).not.toHaveBeenCalled();
  });
});

describe("runNotificationProcess — full run", () => {
  it("runs end-to-end for Telegram with an empty JORF result set", async () => {
    await runNotificationProcess(["Telegram"], {
      telegramBotToken: "TOK"
    });
    expect(h.refreshBlocked).toHaveBeenCalledWith("TOK");
    expect(h.getRecords).toHaveBeenCalledTimes(1);
    expect(h.getMeta).toHaveBeenCalledTimes(1);
  });

  it("runs the WhatsApp re-engagement sweep when WhatsApp is targeted", async () => {
    await runNotificationProcess(["WhatsApp"], {
      whatsAppAPI: {} as unknown as WhatsAppAPI
    });
    expect(h.reengagement).toHaveBeenCalledTimes(1);
  });

  it("logs a warning when NOTIFICATIONS_SHIFT_DAYS is unset", async () => {
    const saved = process.env.NOTIFICATIONS_SHIFT_DAYS;
    delete process.env.NOTIFICATIONS_SHIFT_DAYS;
    await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });
    expect(h.logErrorSpy).toHaveBeenCalledWith(
      "Telegram",
      expect.stringContaining("NOTIFICATIONS_SHIFT_DAYS")
    );
    if (saved !== undefined) process.env.NOTIFICATIONS_SHIFT_DAYS = saved;
  });

  it("logs a warning when NOTIFICATIONS_SHIFT_DAYS is not a number", async () => {
    const saved = process.env.NOTIFICATIONS_SHIFT_DAYS;
    process.env.NOTIFICATIONS_SHIFT_DAYS = "not-a-number";
    await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });
    expect(h.logErrorSpy).toHaveBeenCalledWith(
      "Telegram",
      expect.stringContaining("Invalid NOTIFICATIONS_SHIFT_DAYS")
    );
    if (saved !== undefined) process.env.NOTIFICATIONS_SHIFT_DAYS = saved;
    else delete process.env.NOTIFICATIONS_SHIFT_DAYS;
  });

  it("catches and logs an error thrown mid-run", async () => {
    h.getRecords.mockRejectedValueOnce(new Error("JORF down"));
    await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });
    expect(h.logErrorSpy).toHaveBeenCalledWith(
      "Telegram",
      "Error running notification process: ",
      expect.any(Error)
    );
  });

  it("warns when the run exceeds the duration threshold", async () => {
    vi.useFakeTimers();
    // Advance the clock past the 5-minute warning threshold mid-run so the
    // end-of-run duration check trips the "took too long" warning.
    h.getRecords.mockImplementationOnce(() => {
      vi.advanceTimersByTime(6 * 60 * 1000);
      return Promise.resolve([]);
    });
    try {
      await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });
    } finally {
      vi.useRealTimers();
    }
    expect(h.logErrorSpy).toHaveBeenCalledWith(
      "Telegram",
      expect.stringContaining("took too long")
    );
  });
});

describe("notifyAllFollows — fan-out", () => {
  const windowNow = new Date("2026-01-15T08:00:00Z");

  it("dispatches all record-based handlers with the shared windowNow", async () => {
    const records = [{ source_id: "a" }] as never;
    await notifyAllFollows(records, [], ["Telegram"], {}, windowNow);
    for (const spy of [h.notifyFn, h.notifyOrg, h.notifyPeople, h.notifyName]) {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]).toContain(windowNow);
    }
    expect(h.notifyAlert).not.toHaveBeenCalled();
  });

  it("dispatches the alert-string handler only for meta records", async () => {
    const meta = [{ id: "m" }] as never;
    await notifyAllFollows([], meta, ["Telegram"], {}, windowNow);
    expect(h.notifyAlert).toHaveBeenCalledTimes(1);
    expect(h.notifyPeople).not.toHaveBeenCalled();
  });
});
