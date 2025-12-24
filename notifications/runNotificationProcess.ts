import "dotenv/config";
import { mongodbConnect } from "../db.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { JORFSearchPublication } from "../entities/JORFSearchResponseMeta.ts";
import { MessageApp } from "../types.ts";
import { JORFtoDate } from "../utils/date.utils.ts";
import {
  callJORFSearchDay,
  callJORFSearchMetaDay
} from "../utils/JORFSearch.utils.ts";
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

// Number of days to go back: 0 means we just fetch today's info
const SHIFT_DAYS = 15;

async function getJORFRecordsFromDate(
  startDate: Date,
  messageApps: MessageApp[]
): Promise<JORFSearchItem[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);

  const dayCount = (today.getTime() - startDate.getTime()) / 86_400_000 + 1;
  const days: Date[] = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    return d;
  });

  const limit = 8;
  const chunks: Date[][] = [];
  for (let i = 0; i < days.length; i += limit)
    chunks.push(days.slice(i, i + limit));

  const results: (JORFSearchItem[] | null)[] = [];
  for (const sub of chunks) {
    results.push(
      ...(await Promise.all(
        sub.map((day: Date) => callJORFSearchDay(day, messageApps))
      ))
    );
  }

  return results
    .reduce((fullTab: JORFSearchItem[], resDay) => {
      if (resDay == null) throw new Error("JORFSearch returned a null value");

      return fullTab.concat(resDay);
    }, [])
    .sort(
      (a, b) =>
        JORFtoDate(a.source_date).getTime() -
        JORFtoDate(b.source_date).getTime()
    );
}

async function getJORFMetaRecordsFromDate(
  startDate: Date,
  messageApps: MessageApp[]
): Promise<JORFSearchPublication[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);

  const dayCount = (today.getTime() - startDate.getTime()) / 86_400_000 + 1;
  const days: Date[] = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    return d;
  });

  const limit = 8;
  const chunks: Date[][] = [];
  for (let i = 0; i < days.length; i += limit)
    chunks.push(days.slice(i, i + limit));

  const results: (JORFSearchPublication[] | null)[] = [];
  for (const sub of chunks) {
    results.push(
      ...(await Promise.all(
        sub.map((day: Date) => callJORFSearchMetaDay(day, messageApps))
      ))
    );
  }

  return results
    .reduce((fullTab: JORFSearchPublication[], resDay) => {
      if (resDay == null) throw new Error("JORFSearch returned a null value");

      return fullTab.concat(resDay);
    }, [])
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

async function saveNewMetaPublications(
  metaRecords: JORFSearchPublication[]
): Promise<void> {
  const ids = metaRecords.map((record) => record.id);
  const existing: JORFSearchPublication[] = await Publication.find({
    id: { $in: ids }
  })
    .select("id")
    .lean();
  const existingIds = new Set(existing.map((record) => record.id));

  const addedIds = new Set<string>();

  const newRecords = metaRecords
    .filter((record) => !existingIds.has(record.id))
    .reduce((tab: JORFSearchPublication[], item) => {
      if (!addedIds.has(item.id)) tab.push(item);
      return tab;
    }, []);

  if (newRecords.length > 0) {
    await Publication.insertMany(newRecords, { ordered: false });
    await umami.logAsync({
      event: "/publication-added",
      payload: { nb: newRecords.length },
      hasAccount: true
    });
  }
}

export async function runNotificationProcess(
  targetApps: MessageApp[],
  messageAppsOptions: ExternalMessageOptions
): Promise<void> {
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

    for (const appType of targetApps) {
      await umami.logAsync({
        event: "/notification-process-completed",
        messageApp: appType,
        hasAccount: true
      });
    }
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
