import { MessageApp } from "../types.ts";
import { TELEGRAM_API_SENDING_CONCURRENCY } from "../entities/TelegramSession.ts";
import { WHATSAPP_API_SENDING_CONCURRENCY } from "../entities/WhatsAppSession.ts";
import { SIGNAL_API_SENDING_CONCURRENCY } from "../entities/SignalSession.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { Types } from "mongoose";
import pLimit from "p-limit";
import { MATRIX_API_SENDING_CONCURRENCY } from "../entities/MatrixSession.ts";
import { ExtendedMiniUserInfo } from "../entities/Session.ts";
import { logError } from "../utils/debugLogger.ts";

/**
 * Schedules the sendMessage to respect per-app throttling rules.
 * Returns the promise representing the delivery attempt.
 */
export interface NotificationTask<T, R = JORFSearchItem> {
  userId: Types.ObjectId;
  userInfo: ExtendedMiniUserInfo;
  updatedRecordsMap: Map<T, R[]>;
  recordCount: number;
}

export async function dispatchTasksToMessageApps<T, R = JORFSearchItem>(
  taskList: NotificationTask<T, R>[],
  taskFunction: (task: NotificationTask<T, R>) => Promise<void>
): Promise<void> {
  taskList.sort((a, b) => b.recordCount - a.recordCount);

  const concurrencyLimitByMessageApp = new Map<MessageApp, number>();

  concurrencyLimitByMessageApp.set("Matrix", MATRIX_API_SENDING_CONCURRENCY);
  concurrencyLimitByMessageApp.set("Tchap", MATRIX_API_SENDING_CONCURRENCY);
  concurrencyLimitByMessageApp.set(
    "Telegram",
    TELEGRAM_API_SENDING_CONCURRENCY
  );
  concurrencyLimitByMessageApp.set(
    "WhatsApp",
    WHATSAPP_API_SENDING_CONCURRENCY
  );
  concurrencyLimitByMessageApp.set("Signal", SIGNAL_API_SENDING_CONCURRENCY);

  const tasksByMessageApp = new Map<MessageApp, NotificationTask<T, R>[]>();
  taskList.forEach((task) => {
    tasksByMessageApp.set(
      task.userInfo.messageApp,
      (tasksByMessageApp.get(task.userInfo.messageApp) ?? []).concat(task)
    );
  });

  const appPromises = [...tasksByMessageApp.keys()].map(async (messageApp) => {
    const appTasks = tasksByMessageApp.get(messageApp) ?? [];

    if (messageApp === "WhatsApp") {
      // Edge-first: send the users closest to their 24h re-engagement window edge
      // first, so the slow run reaches them in its first seconds and they keep the
      // benefit of the scheduler's day-of-week start-advance instead of losing it to
      // queue latency. Record count is only a tiebreaker here. (lastEngagementAt asc)
      appTasks.sort(
        (a, b) =>
          a.userInfo.lastEngagementAt.getTime() -
            b.userInfo.lastEngagementAt.getTime() ||
          b.recordCount - a.recordCount
      );
    } else {
      // this ensures coherent size within batches, so they don't wait too much for each other
      appTasks.sort((a, b) => b.recordCount - a.recordCount);
    }

    // Isolate each task: a single send that throws must never reject the
    // app-level Promise.all and abort the whole run (and every later handler)
    // for all remaining users. Log and drop only the failing user.
    const runTask = async (task: NotificationTask<T, R>) => {
      try {
        await taskFunction(task);
      } catch (err) {
        await logError(
          messageApp,
          `Notification task failed for user ${task.userInfo.chatId}`,
          err
        );
      }
    };

    const app_concurrency_limit =
      concurrencyLimitByMessageApp.get(messageApp) ?? 1;
    if (app_concurrency_limit > 1) {
      const limit = pLimit(concurrencyLimitByMessageApp.get(messageApp) ?? 1);

      // Wrap each delivery in the limiter
      await Promise.all(appTasks.map((task) => limit(() => runTask(task))));
    } else {
      // if appLimit is 1, just run the taskFunction directly
      for (const task of appTasks) {
        await runTask(task);
      }
    }
  });

  await Promise.all(appPromises);
}
