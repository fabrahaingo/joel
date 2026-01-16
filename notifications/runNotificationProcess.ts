import "dotenv/config";
import { mongodbConnect } from "../db.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { JORFSearchPublication } from "../entities/JORFSearchResponseMeta.ts";
import { MessageApp } from "../types.ts";
import { notifyOrganisationsUpdates } from "./organisationNotifications.ts";
import { notifyPeopleUpdates } from "./peopleNotifications.ts";
import { notifyNameMentionUpdates } from "./nameNotifications.ts";
import { notifyFunctionTagsUpdates } from "./functionTagNotifications.ts";
import { notifyAlertStringUpdates } from "./alertStringNotifications.ts";
import umami from "../utils/umami.ts";
import mongoose, { Types } from "mongoose";

import { ExternalMessageOptions } from "../entities/Session.ts";
import { Publication } from "../models/Publication.ts";
import { refreshTelegramBlockedUsers } from "../entities/TelegramSession.ts";
import { logError } from "../utils/debugLogger.ts";
import {
  getJORFMetaRecordsFromDate,
  getJORFRecordsFromDate
} from "../utils/JORFSearch.utils.ts";
import { formatDuration } from "../utils/date.utils.ts";
import { normalizeFrenchText } from "../utils/text.utils.ts";

async function saveNewMetaPublications(
  metaRecords: JORFSearchPublication[]
): Promise<void> {
  // 1) Deduplicate within the batch (by normalized JORF id)
  const byId = new Map<string, JORFSearchPublication>();
  for (const r of metaRecords) {
    const key = r.id; // normalize type
    if (!byId.has(key)) byId.set(key, r);
  }

  const records = Array.from(byId.entries()).map(([id, doc]) => {
    const normalizedTitle = normalizeFrenchText(doc.title);
    return {
      ...doc,
      id: id,
      normalizedTitle,
      normalizedTitleWords: normalizedTitle.split(" ").filter(Boolean)
    };
  });
  if (records.length === 0) return;

  // 2) Upsert using $setOnInsert so repeats do not create new docs
  const ops = records.map((doc) => ({
    updateOne: {
      filter: { id: doc.id },
      update: { $setOnInsert: doc },
      upsert: true
    }
  }));

  const res = await Publication.bulkWrite(ops, { ordered: false });

  // bulkWrite returns how many were actually inserted via upsert
  if (res.upsertedCount > 0) {
    await umami.logAsync({
      event: "/publication-added",
      payload: { nb: res.upsertedCount }
    });
  }
}

const NOTIFICATION_DURATION_BEFORE_WARNING_MS = 5 * 60 * 1000; // 5 minutes

export async function runNotificationProcess(
  targetApps: MessageApp[],
  messageAppsOptions: ExternalMessageOptions
): Promise<void> {
  const start = new Date();
  console.log("Notification started.");
  try {
    if (
      targetApps.some((a) => a === "Matrix") &&
      messageAppsOptions.matrixClient == null
    ) {
      await logError(
        "Matrix",
        `Notification process skipped as the Matrix client is not set.`
      );
      return;
    }
    if (
      targetApps.some((a) => a === "Telegram") &&
      messageAppsOptions.telegramBotToken == null
    ) {
      await logError(
        "Telegram",
        `Notification process skipped as the bot token is not set.`
      );
      return;
    }

    if (
      targetApps.some((a) => a === "Signal") &&
      messageAppsOptions.signalCli == null
    ) {
      await logError(
        "Signal",
        `Notification process skipped as the signal client is not set.`
      );
      return;
    }

    if (
      targetApps.some((a) => a === "WhatsApp") &&
      messageAppsOptions.whatsAppAPI == null
    ) {
      await logError(
        "WhatsApp",
        `Notification process skipped as the WhatsApp client is not set.`
      );
      return;
    }

    // Start mdb connection if not already connected
    if (mongoose.connection.readyState.valueOf() != 1) await mongodbConnect();

    if (targetApps.includes("Telegram")) {
      await refreshTelegramBlockedUsers(messageAppsOptions.telegramBotToken);
    }

    // Number of days to go back: 0 means we just fetch today's info
    const SHIFT_DAYS_ENV = process.env.NOTIFICATIONS_SHIFT_DAYS;

    if (SHIFT_DAYS_ENV == null) {
      for (const appType of targetApps) {
        void logError(
          appType,
          "Missing NOTIFICATIONS_SHIFT_DAYS env var not set: using 0"
        );
      }
    }
    let SHIFT_DAYS = 0;
    if (SHIFT_DAYS_ENV != null) {
      const parsedShiftDays = parseInt(SHIFT_DAYS_ENV, 10);
      if (Number.isNaN(parsedShiftDays)) {
        for (const appType of targetApps) {
          void logError(
            appType,
            `Invalid NOTIFICATIONS_SHIFT_DAYS env var value "${SHIFT_DAYS_ENV}": using 0`
          );
        }
      } else {
        SHIFT_DAYS = parsedShiftDays;
      }
    }

    const currentDate = new Date();
    const startDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate() - SHIFT_DAYS
    );
    startDate.setHours(0, 0, 0, 0);

    const JORFAllRecordsFromDate = await getJORFRecordsFromDate(
      startDate,
      targetApps
    );
    const JORFMetaRecordsFromDate = await getJORFMetaRecordsFromDate(
      startDate,
      targetApps
    );

    await notifyAllFollows(
      JORFAllRecordsFromDate,
      JORFMetaRecordsFromDate,
      targetApps,
      messageAppsOptions
    );

    const duration_s = Math.ceil(
      (new Date().getTime() - start.getTime()) / 1000
    );

    for (const appType of targetApps) {
      await umami.logAsync({
        event: "/notification-process-completed",
        messageApp: appType,
        hasAccount: true,
        payload: { duration_s }
      });
    }

    const end = new Date();

    const delay = end.getTime() - start.getTime();
    if (
      end.getTime() - start.getTime() >
      NOTIFICATION_DURATION_BEFORE_WARNING_MS
    ) {
      for (const appType of targetApps) {
        await logError(
          appType,
          `Notification process took too long: ${formatDuration(delay)}.`
        );
      }
    }
    console.log(`Notification ended: took ${formatDuration(delay)}.`);
  } catch (err) {
    for (const appType of targetApps) {
      await logError(appType, "Error running notification process: ", err);
    }
  }
}

export async function notifyAllFollows(
  JORFAllRecordsFromDate: JORFSearchItem[],
  JORFMetaRecordsFromDate: JORFSearchPublication[],
  targetApps: MessageApp[],
  messageAppsOptions: ExternalMessageOptions,
  userIds?: Types.ObjectId[],
  forceWHMessages = false
) {
  if (JORFAllRecordsFromDate.length > 0) {
    await notifyFunctionTagsUpdates(
      JORFAllRecordsFromDate,
      targetApps,
      messageAppsOptions,
      userIds,
      forceWHMessages
    );

    await notifyOrganisationsUpdates(
      JORFAllRecordsFromDate,
      targetApps,
      messageAppsOptions,
      userIds,
      forceWHMessages
    );

    await notifyPeopleUpdates(
      JORFAllRecordsFromDate,
      targetApps,
      messageAppsOptions,
      userIds,
      forceWHMessages
    );

    await notifyNameMentionUpdates(
      JORFAllRecordsFromDate,
      targetApps,
      messageAppsOptions
    );
  }

  if (JORFMetaRecordsFromDate.length > 0) {
    await saveNewMetaPublications(JORFMetaRecordsFromDate);
    await notifyAlertStringUpdates(
      JORFMetaRecordsFromDate,
      targetApps,
      messageAppsOptions
    );
  }
}
