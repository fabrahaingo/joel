import "dotenv/config";
import { MessageApp } from "../types.ts";
import {
  logNotificationOutcome,
  runNotificationProcess
} from "./runNotificationProcess.ts";
import { ExternalMessageOptions } from "../entities/Session.ts";
import { logError, logWarning } from "../utils/debugLogger.ts";
import { dateToString, formatDuration } from "../utils/date.utils.ts";
import { WHATSAPP_SHIFT_STEP_MINS } from "../entities/WhatsAppSession.ts";

interface DailyTime {
  hour: number;
  minute: number;
}

// Used when the next occurrence cannot be computed: losing the reschedule would
// end notifications for the whole process until someone restarts it, so the
// loop retries on this cadence instead of unwinding.
const RESCHEDULE_RETRY_DELAY_MS = 60 * 60 * 1000;

// A run that never settles would take the whole schedule with it, because the
// next occurrence is only armed once the current one finishes. Well above any
// legitimate run (the slow-run warning trips at 15 minutes) and well under the
// daily cadence, so it only fires on a genuine hang.
const RUN_WATCHDOG_MS = 6 * 60 * 60 * 1000;

class RunWatchdogError extends Error {}

/**
 * Rejects if `task` outstays `timeoutMs`. The task itself keeps running: it
 * cannot be cancelled, so the caller reschedules around it and lets the
 * still-running guard report the cycles it overlaps.
 */
async function withWatchdog<T>(
  task: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new RunWatchdogError(
              `Notification process still unfinished after ${formatDuration(timeoutMs)}`
            )
          );
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

export function computeNextOccurrence(
  { hour, minute }: DailyTime,
  messageApps: MessageApp[],
  // Injectable for tests; defaults to wall-clock in production.
  now: Date = new Date()
): Date {
  const currentDayString = dateToString(now, "YMD");

  const nextWithoutShift = new Date(now);
  if (
    process.env.NODE_ENV !== "development" && // notify without day shift in production
    (currentDayString === lastNotificationDayString || // if already sent today, set to tomorrow
      (lastNotificationDayString == null && now.getHours() > 6)) // only restarts after 6am will skip the current day
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
    timeShiftMs = timeShiftIndex * WHATSAPP_SHIFT_STEP_MINS * 60 * 1000;
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
      `WhatsApp is part of targetApps. Tomorrow is ${nextDayString}. Advancing target time by ${String(timeShiftIndex)} x ${String(WHATSAPP_SHIFT_STEP_MINS)}min (WHATSAPP_SHIFT_STEP_MINS)`
    );
  }

  const next = new Date(nextWithoutShift.getTime() - timeShiftMs);

  if (next.getTime() <= now.getTime()) {
    const errorMsg = `Failed to compute next occurrence for daily notification jobs: computed time is in the past: now (${now.toISOString()}), next (${next.toISOString()}).`;
    if (process.env.NODE_ENV !== "production") {
      console.log(errorMsg);
      console.log("Adding 1 day in development mode.");
      next.setDate(next.getDate() + 1);
    } else {
      for (const app of messageApps) {
        void logError(app, errorMsg);
      }
      throw new Error(errorMsg);
    }
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
  // Only the most recently armed timer may act. The watchdog can leave a hung
  // run behind that still reschedules when it eventually settles, and without
  // this the two chains would both keep firing forever.
  let scheduleToken = 0;

  const scheduleNextRun = () => {
    const token = ++scheduleToken;

    let nextRun: Date;
    try {
      nextRun = computeNextOccurrence(parsedTime, messageApps);
    } catch (error) {
      void Promise.all(
        messageApps.map((app) =>
          logError(
            app,
            `Could not compute the next notification time; retrying in ${formatDuration(RESCHEDULE_RETRY_DELAY_MS)}.`,
            error
          )
        )
      );
      setTimeout(() => {
        if (token !== scheduleToken) return;
        scheduleNextRun();
      }, RESCHEDULE_RETRY_DELAY_MS);
      return;
    }
    const delay = nextRun.getTime() - Date.now();

    setTimeout(() => {
      void (async () => {
        if (token !== scheduleToken) return;
        if (running) {
          await Promise.all(
            messageApps.map((app) =>
              logWarning(
                app,
                `${app}: notification process is still running when the next schedule fired. Skipping this cycle.`
              )
            )
          );
          // Reported like any other cycle: one event per app per fired
          // schedule is what makes a missing event mean "the process was down"
          // rather than "something swallowed it".
          await logNotificationOutcome(messageApps, "skipped", 0, [
            "previous run still in progress"
          ]);
          scheduleNextRun();
          return;
        }

        running = true;
        const runPromise = runNotificationProcess(messageApps, messageOptions);
        // Bound to the run itself rather than to the wait below, so a run the
        // watchdog gave up on still releases the flag if it later settles.
        // Until it does, the still-running guard reports every cycle it eats
        // instead of the schedule going quiet.
        void runPromise
          .catch(() => undefined)
          .finally(() => {
            running = false;
            lastNotificationDayString = dateToString(new Date(), "YMD");
          });

        try {
          await withWatchdog(runPromise, RUN_WATCHDOG_MS);
        } catch (error) {
          await Promise.all(
            messageApps.map((app) =>
              logError(app, `${app}: error during notification process`, error)
            )
          );
          if (error instanceof RunWatchdogError) {
            await logNotificationOutcome(messageApps, "failed", 0, [
              "run did not finish within the watchdog"
            ]);
          }
        } finally {
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
