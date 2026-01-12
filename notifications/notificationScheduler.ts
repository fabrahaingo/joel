import "dotenv/config";
import { MessageApp } from "../types.ts";
import { runNotificationProcess } from "./runNotificationProcess.ts";
import { ExternalMessageOptions } from "../entities/Session.ts";
import { logError, logWarning } from "../utils/debugLogger.ts";
import { dateToString, formatDuration } from "../utils/date.utils.ts";
import { WHATSAPP_REENGAGEMENT_MARGIN_MINS } from "../entities/WhatsAppSession.ts";

interface DailyTime {
  hour: number;
  minute: number;
}

let lastNotificationDayString: string | null = null;

function parseDailyTime(value: string): DailyTime {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match == null) {
    throw new Error(
      `Invalid time format in DAILY_NOTIFICATION_TIME. Expected HH:MM, received "${value}".`
    );
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(
      `DAILY_NOTIFICATION_TIME must be a valid 24h time. Received ${value}.`
    );
  }

  return { hour, minute };
}

function computeNextOccurrence(
  { hour, minute }: DailyTime,
  messageApps: MessageApp[]
): Date {
  const now = new Date();

  const currentDayString = dateToString(now, "YMD");

  const nextWithoutShift = new Date(now);
  if (
    process.env.NODE_ENV !== "development" && // notify without day shift in production
    (currentDayString === lastNotificationDayString || // if already sent today, set to tomorrow
      (lastNotificationDayString == null && now.getHours() > 6)) // very early morning restarts don't skip the day notif
  )
    nextWithoutShift.setDate(nextWithoutShift.getDate() + 1);
  nextWithoutShift.setHours(hour, minute, 0, 0);

  let timeShiftMs = 0;
  if (messageApps.some((m) => m === "WhatsApp")) {
    // advance next trigger time to make sure the notification from the day before was sent during the window with margin
    const timeShiftIndex = (nextWithoutShift.getDay() + 5) % 7;
    if (timeShiftIndex < 0) {
      void logError(
        "WhatsApp",
        `Computed negative timeShiftIndex: ${String(timeShiftIndex)}`
      );
      throw new Error(
        `Computed negative timeShiftIndex: ${String(timeShiftIndex)}`
      );
    }
    timeShiftMs =
      timeShiftIndex * WHATSAPP_REENGAGEMENT_MARGIN_MINS * 60 * 1000;
    // Tuesday : expected time
    // Wednesday: expected time - 1*MARGIN
    // Thursday: expected time - 2*MARGIN
    // Friday: expected time - 3*MARGIN
    // Saturday: expected time - 4*MARGIN
    // Sunday: expected time - 5*MARGIN
    // Monday: expected time - 6*MARGIN (despite no notification being expected)

    let nextDayString = "";
    switch (nextWithoutShift.getDay()) {
      case 0:
        nextDayString = "Sunday";
        break;
      case 1:
        nextDayString = "Monday";
        break;
      case 2:
        nextDayString = "Tuesday";
        break;
      case 3:
        nextDayString = "Wednesday";
        break;
      case 4:
        nextDayString = "Thursday";
        break;
      case 5:
        nextDayString = "Friday";
        break;
      case 6:
        nextDayString = "Saturday";
        break;
    }

    console.log(
      `WhatsApp is part of targetApps. Tomorrow is ${nextDayString}. Advancing target time by ${String(timeShiftIndex)}*WH_REENGAGEMENT_WINDOWS_MARGIN`
    );
  }

  const next = new Date(nextWithoutShift.getTime() - timeShiftMs);

  if (next.getTime() <= now.getTime()) {
    const errorMsg = `Failed to compute next occurrence for daily notification jobs: computed time is in the past: now (${now.toISOString()}), next (${next.toISOString()}).`;
    for (const app of messageApps) {
      void logError(app, errorMsg);
    }
    throw new Error(errorMsg);
  }
  return next;
}

export function startDailyNotificationJobs(
  messageApps: MessageApp[],
  messageOptions: ExternalMessageOptions
): void {
  const configuredTime = process.env.DAILY_NOTIFICATION_TIME;

  const appsToString = messageApps.join(", ");
  if (configuredTime == null) {
    throw new Error(
      `${appsToString}: DAILY_NOTIFICATION_TIME environment variable must be defined to schedule notifications.`
    );
  }

  const parsedTime = parseDailyTime(configuredTime);

  let running = false;

  const scheduleNextRun = () => {
    const nextRun = computeNextOccurrence(parsedTime, messageApps);
    const delay = nextRun.getTime() - Date.now();

    setTimeout(() => {
      void (async () => {
        if (running) {
          await Promise.all(
            messageApps.map((app) =>
              logWarning(
                app,
                `${app}: notification process is still running when the next schedule fired. Skipping this cycle.`
              )
            )
          );
          scheduleNextRun();
          return;
        }

        running = true;
        try {
          await runNotificationProcess(messageApps, messageOptions);
        } catch (error) {
          await Promise.all(
            messageApps.map((app) =>
              logError(app, `${app}: error during notification process`, error)
            )
          );
        } finally {
          running = false;
          lastNotificationDayString = dateToString(new Date(), "YMD");
          scheduleNextRun();
        }
      })();
    }, delay);

    console.log(
      `${appsToString}: next notification process scheduled for ${nextRun.toISOString()} (in ${formatDuration(delay)})`
    );
  };

  scheduleNextRun();
}
