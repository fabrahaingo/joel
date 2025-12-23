import {
  ExternalMessageOptions,
  MessageSendingOptionsExternal,
  MiniUserInfo,
  sendMessage
} from "../entities/Session.ts";
import { JORFSearchPublication } from "../entities/JORFSearchResponseMeta.ts";
import { IUser, JORFReference, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import umami, { UmamiNotificationData } from "../utils/umami.ts";
import { dateToFrenchString } from "../utils/date.utils.ts";
import { fuzzyIncludes, getSplitTextMessageSize } from "../utils/text.utils.ts";
import {
  NotificationTask,
  dispatchTasksToMessageApps
} from "./notificationDispatch.ts";
import { FilterQuery, Types } from "mongoose";
import { logError } from "../utils/debugLogger.ts";
import { sendWhatsAppTemplate } from "../entities/WhatsAppSession.ts";

const DEFAULT_GROUP_SEPARATOR = "\n====================\n\n";

export async function notifyAlertStringUpdates(
  metaRecords: JORFSearchPublication[],
  enabledApps: MessageApp[],
  messageAppsOptions: ExternalMessageOptions,
  userIds?: Types.ObjectId[],
  forceWHMessages = false
) {
  if (metaRecords.length === 0) return;

  let dbFilters: FilterQuery<IUser> = {
    "followedMeta.0": { $exists: true },
    status: "active",
    messageApp: { $in: enabledApps }
  };

  if (userIds != null) {
    if (userIds.length === 0) {
      throw new Error("Empty userIds provided to notifyAlertStringUpdates");
    }
    dbFilters = { ...dbFilters, _id: { $in: userIds } };
  }

  const usersFollowingAlerts: IUser[] = await User.find(dbFilters, {
    _id: 1,
    messageApp: 1,
    chatId: 1,
    roomId: 1,
    status: 1,
    followedMeta: 1,
    waitingReengagement: 1
  }).lean();

  if (usersFollowingAlerts.length === 0) return;

  const now = new Date();
  const userUpdateTasks: NotificationTask<string, JORFSearchPublication>[] = [];

  for (const user of usersFollowingAlerts) {
    const newAlertUpdates = new Map<string, JORFSearchPublication[]>();

    for (const follow of user.followedMeta) {
      if (!follow.alertString) continue;
      const updatesForAlert = metaRecords.filter((record) =>
        fuzzyIncludes(record.title, follow.alertString)
      );

      const lastUpdate = follow.lastUpdate;
      const dateFilteredUpdates = updatesForAlert.filter((record) => {
        const publicationDate = record.date ? new Date(record.date) : null;
        return publicationDate
          ? publicationDate.getTime() > lastUpdate.getTime()
          : true;
      });

      if (dateFilteredUpdates.length > 0) {
        newAlertUpdates.set(follow.alertString, dateFilteredUpdates);
      }
    }

    let totalUserRecordsCount = 0;
    newAlertUpdates.forEach((items) => {
      totalUserRecordsCount += items.length;
    });

    if (totalUserRecordsCount > 0) {
      userUpdateTasks.push({
        userId: user._id,
        userInfo: {
          messageApp: user.messageApp,
          chatId: user.chatId,
          roomId: user.roomId,
          status: user.status,
          waitingReengagement: user.waitingReengagement,
          hasAccount: true
        },
        updatedRecordsMap: newAlertUpdates,
        recordCount: totalUserRecordsCount
      });
    }
  }

  if (userUpdateTasks.length === 0) return;

  await dispatchTasksToMessageApps<string, JORFSearchPublication>(
    userUpdateTasks,
    async (task) => {
      // WH user must be re-engaged before sending notifications
      if (!forceWHMessages && task.userInfo.messageApp === "WhatsApp") {
        const notificationSources = new Map<JORFReference, number>();

        for (const records of task.updatedRecordsMap.values()) {
          for (const record of records) {
            notificationSources.set(
              record.id,
              (notificationSources.get(record.id) ?? 0) + 1
            );
          }
        }

        await User.insertPendingNotifications(
          task.userId,
          "meta",
          notificationSources
        );

        if (!task.userInfo.waitingReengagement) {
          const whatsAppAPI = messageAppsOptions.whatsAppAPI;
          if (whatsAppAPI == null) {
            await logError(
              "WhatsApp",
              "Undefined messageAppsOptions.whatsAppAPI in notifyAlertStringUpdates"
            );
            return;
          }
          await sendWhatsAppTemplate(
            whatsAppAPI,
            task.userInfo.chatId,
            "notification_meta",
            messageAppsOptions
          );

          await User.updateOne(
            { _id: task.userId },
            { $set: { waitingReengagement: true } }
          );
        }

        return;
      }

      const messageSent = await sendAlertStringUpdate(
        task.userInfo,
        task.updatedRecordsMap,
        messageAppsOptions
      );

      if (!messageSent) return;

      await User.updateOne(
        { _id: task.userId },
        {
          $set: {
            "followedMeta.$[elem].lastUpdate": now
          }
        },
        {
          arrayFilters: [
            {
              "elem.alertString": { $in: [...task.updatedRecordsMap.keys()] }
            }
          ]
        }
      );
    }
  );
}

async function sendAlertStringUpdate(
  userInfo: MiniUserInfo,
  updatedRecordMap: Map<string, JORFSearchPublication[]>,
  messageAppsOptions: ExternalMessageOptions
): Promise<boolean> {
  if (updatedRecordMap.size === 0) return true;

  const pluralHandler = updatedRecordMap.size > 1 ? "s" : "";
  const markdownLinkEnabled = userInfo.messageApp !== "WhatsApp";

  let notificationText = `📢 Nouvelle${pluralHandler} alerte${pluralHandler} texte :\n\n`;

  const keys = Array.from(updatedRecordMap.keys());
  const lastKey = keys[keys.length - 1];

  for (const alert of updatedRecordMap.keys()) {
    const updates = updatedRecordMap.get(alert);
    if (!updates || updates.length === 0) continue;

    notificationText += `🔔 *${alert}*\n`;

    for (const record of updates) {
      const publicationLink = `https://bodata.steinertriples.ch/${record.id}/redirect`;
      const dateString = record.date
        ? dateToFrenchString(record.date)
        : undefined;

      notificationText += `• ${record.title}\n`;
      if (dateString) notificationText += `🗓️ ${dateString}\n`;
      notificationText += markdownLinkEnabled
        ? `🔗 [Lien vers le texte](${publicationLink})\n\n`
        : `🔗 ${publicationLink}\n\n`;
    }

    if (alert !== lastKey) notificationText += DEFAULT_GROUP_SEPARATOR;
  }

  const messageAppsOptionsApp: MessageSendingOptionsExternal = {
    ...messageAppsOptions,
    separateMenuMessage: userInfo.messageApp === "WhatsApp",
    useAsyncUmamiLog: true,
    hasAccount: true
  };

  const messageSent = await sendMessage(
    userInfo,
    notificationText,
    messageAppsOptionsApp
  );
  if (!messageSent) return false;

  const notifData: UmamiNotificationData = {
    message_nb: getSplitTextMessageSize(notificationText, userInfo.messageApp),
    updated_follows_nb: updatedRecordMap.size,
    total_records_nb: updatedRecordMap
      .values()
      .reduce((total: number, value) => total + value.length, 0)
  };

  await umami.logAsync({
    event: "/notification-update-meta",
    messageApp: userInfo.messageApp,
    notificationData: notifData,
    hasAccount: true
  });

  return true;
}
