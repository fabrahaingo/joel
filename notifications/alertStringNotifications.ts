import {
  ExtendedMiniUserInfo,
  ExternalMessageOptions,
  MessageSendingOptionsExternal,
  sendMessage
} from "../entities/Session.ts";
import { JORFSearchPublication } from "../entities/JORFSearchResponseMeta.ts";
import { IUser, JORFReference, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import umami, { UmamiNotificationData } from "../utils/umami.ts";
import {
  dateToFrenchString,
  formatDuration,
  timeDaysBetweenDates
} from "../utils/date.utils.ts";
import { fuzzyIncludes, getSplitTextMessageSize } from "../utils/text.utils.ts";
import {
  NotificationTask,
  dispatchTasksToMessageApps
} from "./notificationDispatch.ts";
import { FilterQuery, Types } from "mongoose";
import { logError } from "../utils/debugLogger.ts";
import {
  sendWhatsAppTemplate,
  WHATSAPP_NEAR_MISS_WINDOW_MS,
  WHATSAPP_REENGAGEMENT_TIMEOUT_WITH_MARGIN_MS
} from "../entities/WhatsAppSession.ts";

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
    waitingReengagement: 1,
    lastEngagementAt: 1
  }).lean();

  if (usersFollowingAlerts.length === 0) return;

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
          hasAccount: true,
          lastEngagementAt: user.lastEngagementAt
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
      const now = new Date();

      const reengagementExpired =
        now.getTime() - task.userInfo.lastEngagementAt.getTime() >
        WHATSAPP_REENGAGEMENT_TIMEOUT_WITH_MARGIN_MS;

      // WH user must be re-engaged before sending notifications
      if (
        task.userInfo.messageApp === "WhatsApp" &&
        !forceWHMessages &&
        reengagementExpired
      ) {
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
          task.userInfo.messageApp,
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
          const templateSent = await sendWhatsAppTemplate(
            whatsAppAPI,
            task.userInfo,
            "meta",
            messageAppsOptions
          );
          if (!templateSent) return;

          const res = await User.updateOne(
            { _id: task.userId },
            { $set: { waitingReengagement: true } }
          );
          if (res.modifiedCount === 0) {
            await logError(
              task.userInfo.messageApp,
              `No waitingReengagement updated for user ${task.userId.toString()} after sending function WH template on text update`
            );
          }

          // If near miss (user engaged very recently)
          if (
            now.getTime() - task.userInfo.lastEngagementAt.getTime() <
            WHATSAPP_NEAR_MISS_WINDOW_MS
          ) {
            const miss_out_delay_s = Math.floor(
              (now.getTime() -
                task.userInfo.lastEngagementAt.getTime() -
                24 * 60 * 60 * 1000) /
                1000
            );
            await umami.logAsync({
              event: "/wh-reengagement-near-miss",
              messageApp: "WhatsApp",
              hasAccount: true,
              payload: {
                delay_s: Math.floor(
                  (now.getTime() - task.userInfo.lastEngagementAt.getTime()) /
                    1000
                ),
                notification_type: "meta",
                miss_out_delay_s
              }
            });
            await logError(
              "WhatsApp",
              `WH user reengagement near-miss: 24 hour window (from ${task.userInfo.lastEngagementAt.toISOString()} to now (${now.toISOString()}), missed by ${formatDuration(miss_out_delay_s)}`
            );
          }
        }

        // Update lastUpdate for pending notifications to avoid duplicate processing
        const updatedAlertStrings = [...task.updatedRecordsMap.keys()];
        const res = await User.updateOne(
          { _id: task.userId },
          {
            $set: {
              "followedMeta.$[elem].lastUpdate": now
            }
          },
          {
            arrayFilters: [
              {
                "elem.alertString": { $in: updatedAlertStrings }
              }
            ]
          }
        );
        if (res.modifiedCount === 0) {
          await logError(
            task.userInfo.messageApp,
            `No lastUpdate updated for user ${task.userId.toString()} after storing pending text update notifications (WH reengagement)`
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

      const res = await User.updateOne(
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
      if (res.modifiedCount === 0) {
        await logError(
          task.userInfo.messageApp,
          `No lastUpdate updated for user ${task.userId.toString()} after sending text update notifications`
        );
      }
    }
  );
}

async function sendAlertStringUpdate(
  userInfo: ExtendedMiniUserInfo,
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
      .reduce((total: number, value) => total + value.length, 0),
    last_engagement_delay_days: timeDaysBetweenDates(
      userInfo.lastEngagementAt,
      new Date()
    )
  };

  await umami.logAsync({
    event: "/notification-update-meta",
    messageApp: userInfo.messageApp,
    notificationData: notifData,
    hasAccount: true
  });

  return true;
}
