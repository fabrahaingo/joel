import { describe, it, expect, vi, beforeEach } from "vitest";

function emptyRange() {
  return {
    items: [] as unknown[],
    requestedDays: 1,
    failedDates: [] as string[]
  };
}

const h = vi.hoisted(() => ({
  logErrorSpy: vi.fn(() => Promise.resolve()),
  logErrorForAppsSpy: vi.fn(() => Promise.resolve()),
  logWarningForAppsSpy: vi.fn(() => Promise.resolve()),
  umamiVerifiedSpy: vi.fn(() => Promise.resolve(true)),
  getRecords: vi.fn(() => Promise.resolve(emptyRange())),
  getMeta: vi.fn(() => Promise.resolve(emptyRange())),
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
  default: {
    log: vi.fn(),
    logAsync: vi.fn(() => Promise.resolve()),
    logAsyncVerified: h.umamiVerifiedSpy
  }
}));
vi.mock("../utils/debugLogger.ts", () => ({
  logError: h.logErrorSpy,
  logErrorForApps: h.logErrorForAppsSpy,
  logWarningForApps: h.logWarningForAppsSpy
}));
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
  notifyAllFollows,
  coverageCursorFor
} from "../notifications/runNotificationProcess.ts";
import type { WhatsAppAPI } from "whatsapp-api-js/middleware/express";

beforeEach(() => {
  vi.clearAllMocks();
  h.umamiVerifiedSpy.mockResolvedValue(true);
  h.getRecords.mockResolvedValue(emptyRange());
  h.getMeta.mockResolvedValue(emptyRange());
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

  it("keeps running the other source when one JORF fetch throws", async () => {
    h.getRecords.mockRejectedValueOnce(new Error("JORF down"));
    await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });
    expect(h.logErrorForAppsSpy).toHaveBeenCalledWith(
      ["Telegram"],
      expect.stringContaining("Could not fetch JORF records"),
      expect.any(Error)
    );
    expect(h.getMeta).toHaveBeenCalledTimes(1);
  });

  it("reports a partially fetched range and still notifies the fetched days", async () => {
    h.getRecords.mockResolvedValueOnce({
      items: [{ source_id: "a" }],
      requestedDays: 3,
      failedDates: ["2026-08-16"]
    });
    await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });
    expect(h.logErrorForAppsSpy).toHaveBeenCalledWith(
      ["Telegram"],
      expect.stringContaining("1/3 day(s)")
    );
    expect(h.notifyPeople).toHaveBeenCalledTimes(1);

    // Record handlers are held back to just before the gap; the meta range was
    // complete, so its handler keeps the full window clock.
    const gapStart = new Date(2026, 7, 16).getTime();
    const peopleCursor = h.notifyPeople.mock.calls[0][6] as Date;
    expect(peopleCursor.getTime()).toBe(gapStart - 1);
  });

  it("clamps only the source that had a gap", async () => {
    h.getRecords.mockResolvedValueOnce({
      items: [{ source_id: "a" }],
      requestedDays: 2,
      failedDates: ["2026-08-17"]
    });
    h.getMeta.mockResolvedValueOnce({
      items: [{ id: "m" }],
      requestedDays: 2,
      failedDates: []
    });
    await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });

    const peopleCursor = h.notifyPeople.mock.calls[0][6] as Date;
    const alertCursor = h.notifyAlert.mock.calls[0][6] as Date;
    expect(peopleCursor.getTime()).toBe(new Date(2026, 7, 17).getTime() - 1);
    expect(alertCursor.getTime()).toBeGreaterThan(peopleCursor.getTime());
  });

  it("skips the record handlers when no day of the range could be fetched", async () => {
    h.getRecords.mockResolvedValueOnce({
      items: [],
      requestedDays: 2,
      failedDates: ["2026-08-16", "2026-08-17"]
    });
    await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });
    expect(h.logErrorForAppsSpy).toHaveBeenCalledWith(
      ["Telegram"],
      expect.stringContaining("JORFSearch is unreachable")
    );
    expect(h.notifyPeople).not.toHaveBeenCalled();
  });

  it("still runs the re-engagement sweep after a JORF outage", async () => {
    h.getRecords.mockRejectedValueOnce(new Error("JORF down"));
    h.getMeta.mockRejectedValueOnce(new Error("JORF down"));
    await runNotificationProcess(["WhatsApp"], {
      whatsAppAPI: {} as unknown as WhatsAppAPI
    });
    expect(h.reengagement).toHaveBeenCalledTimes(1);
  });

  it("warns when the run exceeds the duration threshold", async () => {
    vi.useFakeTimers();
    // Advance the clock past the warning threshold mid-run so the end-of-run
    // duration check trips the "took too long" warning.
    h.getRecords.mockImplementationOnce(() => {
      vi.advanceTimersByTime(16 * 60 * 1000);
      return Promise.resolve(emptyRange());
    });
    try {
      await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });
    } finally {
      vi.useRealTimers();
    }
    // A slow run costs no notification, so it is a warning and not an error.
    expect(h.logWarningForAppsSpy).toHaveBeenCalledWith(
      ["Telegram"],
      expect.stringContaining("took too long")
    );
    expect(h.logErrorForAppsSpy).not.toHaveBeenCalled();
  });

  it("stays quiet on a run that is merely slow", async () => {
    vi.useFakeTimers();
    h.getRecords.mockImplementationOnce(() => {
      vi.advanceTimersByTime(6 * 60 * 1000);
      return Promise.resolve(emptyRange());
    });
    try {
      await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });
    } finally {
      vi.useRealTimers();
    }
    expect(h.logWarningForAppsSpy).not.toHaveBeenCalled();
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

  it("scopes every handler to the requested users", async () => {
    const userIds = [{ id: "u1" }] as never;

    await notifyAllFollows(
      [{ source_id: "a" }] as never,
      [{ id: "m" }] as never,
      ["Telegram"],
      {},
      windowNow,
      userIds,
      true
    );

    // An on-demand trigger notifies one user: a handler left unscoped would
    // deliver that user's records to everyone else following the same name or
    // alert string.
    for (const spy of [
      h.notifyFn,
      h.notifyOrg,
      h.notifyPeople,
      h.notifyName,
      h.notifyAlert
    ]) {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][4]).toBe(userIds);
      expect(spy.mock.calls[0][5]).toBe(true);
    }
  });

  it("runs the later handlers and reports the failure when one throws", async () => {
    const records = [{ source_id: "a" }] as never;
    h.notifyFn.mockRejectedValueOnce(new Error("tags exploded"));

    const failed = await notifyAllFollows(
      records,
      [],
      ["Telegram"],
      {},
      windowNow
    );

    expect(failed).toEqual(["function tags"]);
    for (const spy of [h.notifyOrg, h.notifyPeople, h.notifyName]) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });
});

describe("runNotificationProcess — outcome reporting", () => {
  const outcomeOf = (call: unknown[]) =>
    (call[0] as { payload: { outcome: string } }).payload.outcome;

  it("reports completed on a clean run", async () => {
    await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });
    expect(h.umamiVerifiedSpy).toHaveBeenCalledTimes(1);
    expect(outcomeOf(h.umamiVerifiedSpy.mock.calls[0])).toBe("completed");
  });

  it("reports degraded and names the step when a fetch had a gap", async () => {
    h.getRecords.mockResolvedValueOnce({
      items: [{ source_id: "a" }],
      requestedDays: 2,
      failedDates: ["2026-08-17"]
    });
    await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });

    const call = h.umamiVerifiedSpy.mock.calls[0][0] as {
      payload: { outcome: string; degraded_steps: string };
    };
    expect(call.payload.outcome).toBe("degraded");
    expect(call.payload.degraded_steps).toContain("JORF records fetch");
  });

  it("reports degraded when a handler failed", async () => {
    h.getRecords.mockResolvedValueOnce({
      items: [{ source_id: "a" }],
      requestedDays: 1,
      failedDates: []
    });
    h.notifyPeople.mockRejectedValueOnce(new Error("boom"));
    await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });

    const call = h.umamiVerifiedSpy.mock.calls[0][0] as {
      payload: { outcome: string; degraded_steps: string };
    };
    expect(call.payload.outcome).toBe("degraded");
    expect(call.payload.degraded_steps).toContain("people handler");
  });

  it("still reports when the run aborts", async () => {
    h.refreshBlocked.mockImplementationOnce(() => {
      throw new Error("unexpected");
    });
    h.getRecords.mockRejectedValueOnce(new Error("and again"));
    h.getMeta.mockRejectedValueOnce(new Error("and again"));
    await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });
    expect(h.umamiVerifiedSpy).toHaveBeenCalledTimes(1);
  });

  it("reports skipped when a client is missing, so the cycle is still counted", async () => {
    await runNotificationProcess(["Telegram"], {});
    expect(outcomeOf(h.umamiVerifiedSpy.mock.calls[0])).toBe("skipped");
  });

  it("reports once per targeted app", async () => {
    await runNotificationProcess(["Telegram", "Matrix"], {
      telegramBotToken: "TOK",
      matrixClient: {} as never
    });
    expect(h.umamiVerifiedSpy).toHaveBeenCalledTimes(2);
  });

  it("raises an alert when umami does not record the event", async () => {
    h.umamiVerifiedSpy.mockResolvedValue(false);
    await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });
    expect(h.logErrorForAppsSpy).toHaveBeenCalledWith(
      ["Telegram"],
      expect.stringContaining("Umami did not record")
    );
  });

  it("survives a blocked-user refresh failure and marks the run degraded", async () => {
    h.refreshBlocked.mockRejectedValueOnce(new Error("telegram down"));
    await runNotificationProcess(["Telegram"], { telegramBotToken: "TOK" });

    const call = h.umamiVerifiedSpy.mock.calls[0][0] as {
      payload: { outcome: string; degraded_steps: string };
    };
    expect(call.payload.outcome).toBe("degraded");
    expect(call.payload.degraded_steps).toContain("blocked-user refresh");
    // The run went on to fetch rather than aborting.
    expect(h.getRecords).toHaveBeenCalledTimes(1);
  });
});

describe("coverageCursorFor", () => {
  const windowNow = new Date("2026-08-18T08:00:00Z");

  it("returns the window clock when every day was fetched", () => {
    expect(coverageCursorFor(windowNow, [])).toEqual(windowNow);
  });

  it("stops just before the oldest unfetched day", () => {
    const cursor = coverageCursorFor(windowNow, ["2026-08-17", "2026-08-15"]);
    const gapStart = new Date(2026, 7, 15);

    expect(cursor.getTime()).toBe(gapStart.getTime() - 1);
    // A record dated on the gap day stays above the cursor, so a later run
    // still picks it up.
    expect(gapStart.getTime()).toBeGreaterThan(cursor.getTime());
  });

  it("never returns a cursor ahead of the window clock", () => {
    const cursor = coverageCursorFor(windowNow, ["2027-01-01"]);
    expect(cursor).toEqual(windowNow);
  });
});
