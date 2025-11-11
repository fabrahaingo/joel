import { IUser, MessageApp } from "../types.ts";
import { TELEGRAM_API_SENDING_CONCURRENCY } from "../entities/TelegramSession.ts";
import { WHATSAPP_API_SENDING_CONCURRENCY } from "../entities/WhatsAppSession.ts";
import { SIGNAL_API_SENDING_CONCURRENCY } from "../entities/SignalSession.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { Types } from "mongoose";
import pLimit from "p-limit";
import { MATRIX_API_SENDING_CONCURRENCY } from "../entities/MatrixSession.ts";

/**
 * Schedules the sendMessage to respect per-app throttling rules.
 * Returns the promise representing the delivery attempt.
 */
export interface NotificationTask<T> {
  userId: Types.ObjectId;
  messageApp: MessageApp;
  chatId: IUser["chatId"];
  updatedRecordsMap: Map<T, JORFSearchItem[]>;
  recordCount: number;
}

export async function dispatchTasksToMessageApps<T>(
  taskList: NotificationTask<T>[],
  taskFunction: (task: NotificationTask<T>) => Promise<void>
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

  const tasksByMessageApp = new Map<MessageApp, NotificationTask<T>[]>();
  taskList.forEach((task) => {
    tasksByMessageApp.set(
      task.messageApp,
      (tasksByMessageApp.get(task.messageApp) ?? []).concat(task)
    );
  });

  const appPromises = [...tasksByMessageApp.keys()].map(async (messageApp) => {
    const appTasks = tasksByMessageApp.get(messageApp) ?? [];

    // this ensures coherent size within batches, so they don't wait too much for each other
    appTasks.sort((a, b) => b.recordCount - a.recordCount);

    const limit = pLimit(concurrencyLimitByMessageApp.get(messageApp) ?? 1);

    // Wrap each delivery in the limiter
    await Promise.all(appTasks.map((task) => limit(() => taskFunction(task))));
  });

  await Promise.all(appPromises);
}
