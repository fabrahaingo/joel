import "dotenv/config";
import { MessageApp } from "../types.ts";
import { runNotificationProcess } from "./runNotificationProcess.ts";

const DAILY_NOTIFICATION_TIME_ENV = "DAILY_NOTIFICATION_TIME";

type DailyTime = {
  hour: number;
  minute: number;
};

function parseDailyTime(value: string): DailyTime {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (match == null) {
    throw new Error(
      `Invalid ${DAILY_NOTIFICATION_TIME_ENV} format. Expected HH:MM, received "${value}".`
    );
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(
      `${DAILY_NOTIFICATION_TIME_ENV} must be a valid 24h time. Received ${value}.`
    );
  }

  return { hour, minute };
}

function computeNextOccurrence({ hour, minute }: DailyTime): Date {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

export function startDailyNotificationJob(appType: MessageApp): void {
  const configuredTime = process.env[DAILY_NOTIFICATION_TIME_ENV];
  if (configuredTime == null) {
    throw new Error(
      `${DAILY_NOTIFICATION_TIME_ENV} environment variable must be defined to schedule notifications.`
    );
  }

  const parsedTime = parseDailyTime(configuredTime);

  let running = false;

  const scheduleNextRun = () => {
    const nextRun = computeNextOccurrence(parsedTime);
    const delay = nextRun.getTime() - Date.now();

    setTimeout(async () => {
      if (running) {
        console.warn(
          `${appType}: notification process is still running when the next schedule fired. Skipping this cycle.`
        );
        scheduleNextRun();
        return;
      }

      running = true;
      try {
        await runNotificationProcess(appType);
      } catch (error) {
        console.error(`${appType}: error during notification process`, error);
      } finally {
        running = false;
        scheduleNextRun();
      }
    }, delay);

    console.log(
      `${appType}: next notification process scheduled for ${nextRun.toISOString()}`
    );
  };

  scheduleNextRun();
}
