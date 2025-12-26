import "dotenv/config";
import { MessageApp } from "../types.ts";
import { runNotificationProcess } from "./runNotificationProcess.ts";
import { ExternalMessageOptions } from "../entities/Session.ts";
import { logError, logWarning } from "../utils/debugLogger.ts";
import { WHATSAPP_REENGAGEMENT_MARGIN_MINS } from "../entities/WhatsAppSession.ts";

interface DailyTime {
  hour: number;
  minute: number;
}

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
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  let timeShiftMs = 0;
  if (messageApps.some((m) => m === "WhatsApp")) {
    // advance next trigger time to make sure the notification from the day before was sent during the window with margin
    const timeShiftIndex = (next.getDay() - 2) % 6;
    timeShiftMs =
      timeShiftIndex * WHATSAPP_REENGAGEMENT_MARGIN_MINS * 60 * 1000;
    // Tuesday : expected time
    // Wednesday: expected time - 1*MARGIN
    // Thursday: expected time - 2*MARGIN
    // Friday: expected time - 3*MARGIN
    // Saturday: expected time - 4*MARGIN
    // Sunday: expected time - 5*MARGIN
    // Monday: expected time - 6*MARGIN (despite no notification being expected)

    console.log(
      `WhatsApp is part of targetApps. Advancing target time by ${String(timeShiftIndex)}*WH_REENGAGEMENT_WINDOWS_MARGIN`
    );
  }
  return new Date(next.getTime() + timeShiftMs);
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

function formatDuration(ms: number): string {
  if (ms < 0) ms = -ms;
  const time = {
    day: Math.floor(ms / 86400000),
    hour: Math.floor(ms / 3600000) % 24,
    minute: Math.floor(ms / 60000) % 60,
    second: Math.floor(ms / 1000) % 60,
    millisecond: Math.floor(ms) % 1000
  };
  return Object.entries(time)
    .filter((val) => val[1] !== 0)
    .map(([key, val]) => `${String(val)} ${key}${val !== 1 ? "s" : ""}`)
    .join(", ");
}
