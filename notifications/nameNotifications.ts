import { FilterQuery, Types } from "mongoose";
import {
  ExtendedMiniUserInfo,
  ExternalMessageOptions,
  MessageSendingOptionsExternal,
  sendMessage
} from "../entities/Session.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { IUser, JORFReference, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import People from "../models/People.ts";
import umami, { UmamiNotificationData } from "../utils/umami.ts";
import { formatSearchResult } from "../utils/formatSearchResult.ts";
import {
  cleanPeopleName,
  getJORFSearchLinkPeople
} from "../utils/JORFSearch.utils.ts";
import {
  NotificationTask,
  dispatchTasksToMessageApps
} from "./notificationDispatch.ts";
import { getSplitTextMessageSize } from "../utils/text.utils.ts";
import { logError } from "../utils/debugLogger.ts";
import {
  sendWhatsAppTemplate,
  WHATSAPP_REENGAGEMENT_TIMEOUT_WITH_MARGIN_MS
} from "../entities/WhatsAppSession.ts";
import { timeDaysBetweenDates } from "../utils/date.utils.ts";

const DEFAULT_GROUP_SEPARATOR = "\n====================\n\n";

async function updateFollowedNamesToFollowedPeople(
  userId: Types.ObjectId,
  updatedRecordsMapKeys: string[],
  peopleIdByFollowedNameMap: Map<string, Types.ObjectId>,
  userFollowingNames: IUser[],
  now: Date,
  errorLogSuffix: string,
  messageApp: string
): Promise<void> {
  const user = userFollowingNames.find(
    (u) => u._id.toString() === userId.toString()
  );
  if (user === undefined) return;

  const peopleIdFollowedByUserStr = user.followedPeople.map((f) =>
    f.peopleId.toString()
  );

  const newFollowsIdUnique = updatedRecordsMapKeys.reduce(
    (tab: Types.ObjectId[], idStr) => {
      const id = peopleIdByFollowedNameMap.get(idStr);
      if (
        id !== undefined &&
        !peopleIdFollowedByUserStr.includes(id.toString())
      )
        tab.push(id);
      return tab;
    },
    []
  );

  const res = await User.updateOne(
    { _id: user._id },
    {
      $pull: {
        followedNames: {
          $in: updatedRecordsMapKeys
        }
      },
      $push: {
        followedPeople: {
          $each: newFollowsIdUnique.map((id) => ({
            peopleId: id,
            lastUpdate: now
          }))
        }
      }
    }
  );
  if (res.modifiedCount === 0) {
    await logError(
      messageApp,
      `No lastUpdate updated for user ${userId.toString()} ${errorLogSuffix}`
    );
  }
}

export async function notifyNameMentionUpdates(
  updatedRecords: JORFSearchItem[],
  enabledApps: MessageApp[],
  messageAppsOptions: ExternalMessageOptions,
  userIds?: Types.ObjectId[],
  forceWHMessages = false
) {
  let dbFilters: FilterQuery<IUser> = {
    "followedNames.0": { $exists: true },
    status: "active",
    messageApp: { $in: enabledApps }
  };

  if (userIds != null) {
    if (userIds.length === 0) {
      throw new Error("Empty userIds provided to notifyNameMentionUpdates");
    }
    dbFilters = { ...dbFilters, _id: { $in: userIds } };
  }

  const userFollowingNames: IUser[] = await User.find(dbFilters, {
    _id: 1,
    messageApp: 1,
    chatId: 1,
    roomId: 1,
    followedNames: 1,
    followedPeople: { peopleId: 1, lastUpdate: 1 },
    schemaVersion: 1,
    status: 1,
    waitingReengagement: 1,
    lastEngagementAt: 1
  }).lean();
  if (userFollowingNames.length === 0) return;

  const nameMaps = updatedRecords.reduce(
    (acc, item: JORFSearchItem) => {
      const nomPrenom = cleanPeopleName(`${item.nom} ${item.prenom}`);
      const prenomNom = cleanPeopleName(`${item.prenom} ${item.nom}`);

      const nomPrenomList = acc.nomPrenomMap.get(nomPrenom) ?? [];
      const prenomNomList = acc.prenomNomMap.get(prenomNom) ?? [];

      nomPrenomList.push(item);
      prenomNomList.push(item);

      acc.nomPrenomMap.set(nomPrenom, nomPrenomList);
      acc.prenomNomMap.set(prenomNom, prenomNomList);

      return acc;
    },
    {
      nomPrenomMap: new Map<string, JORFSearchItem[]>(),
      prenomNomMap: new Map<string, JORFSearchItem[]>()
    }
  );

  const userUpdateTasks: NotificationTask<string>[] = [];

  const peopleIdByFollowedNameMap = new Map<string, Types.ObjectId>();

  for (const user of userFollowingNames) {
    const newUserTagsUpdates = new Map<string, JORFSearchItem[]>();

    for (const followedName of user.followedNames) {
      const cleanFollowedName = cleanPeopleName(followedName);
      const mentions =
        nameMaps.prenomNomMap.get(cleanFollowedName) ??
        nameMaps.nomPrenomMap.get(cleanFollowedName);
      if (mentions === undefined || mentions.length === 0) continue;

      const people = await People.findOrCreate({
        nom: mentions[0].nom,
        prenom: mentions[0].prenom
      });
      peopleIdByFollowedNameMap.set(followedName, people._id);
      newUserTagsUpdates.set(followedName, mentions);
    }

    let totalUserRecordsCount = 0;
    newUserTagsUpdates.forEach((items) => {
      totalUserRecordsCount += items.length;
    });

    if (totalUserRecordsCount > 0)
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
        updatedRecordsMap: newUserTagsUpdates,
        recordCount: totalUserRecordsCount
      });
  }

  if (userUpdateTasks.length === 0) return;

  await dispatchTasksToMessageApps<string>(userUpdateTasks, async (task) => {
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
            record.source_id,
            (notificationSources.get(record.source_id) ?? 0) + 1
          );
        }
      }

      await User.insertPendingNotifications(
        task.userId,
        task.userInfo.messageApp,
        "name",
        notificationSources
      );

      if (!task.userInfo.waitingReengagement) {
        const whatsAppAPI = messageAppsOptions.whatsAppAPI;
        if (whatsAppAPI == null) {
          await logError(
            "WhatsApp",
            "Undefined messageAppsOptions.whatsAppAPI in notifyNameMentionUpdates"
          );
          return;
        }
        const templateSent = await sendWhatsAppTemplate(
          whatsAppAPI,
          task.userInfo,
          "name",
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
            `No waitingReengagement updated for user ${task.userId.toString()} after sending function WH template on name update`
          );
        }
      }

      // Update lastUpdate by converting followedNames to followedPeople
      // This prevents duplicate processing of the same name updates
      await updateFollowedNamesToFollowedPeople(
        task.userId,
        [...task.updatedRecordsMap.keys()],
        peopleIdByFollowedNameMap,
        userFollowingNames,
        now,
        "after storing pending name update notifications",
        task.userInfo.messageApp
      );

      return;
    }

    const messageSent = await sendNameMentionUpdates(
      task.userInfo,
      task.updatedRecordsMap,
      messageAppsOptions
    );

    if (messageSent) {
      await updateFollowedNamesToFollowedPeople(
        task.userId,
        [...task.updatedRecordsMap.keys()],
        peopleIdByFollowedNameMap,
        userFollowingNames,
        now,
        "after sending name update notifications",
        task.userInfo.messageApp
      );
    }
  });
}

export async function sendNameMentionUpdates(
  userInfo: ExtendedMiniUserInfo,
  updatedRecordMap: Map<string, JORFSearchItem[]>,
  messageAppsOptions: ExternalMessageOptions
): Promise<boolean> {
  if (updatedRecordMap.size === 0) return true;

  const pluralHandler = updatedRecordMap.size > 1 ? "s" : "";

  const markdownLinkEnabled = userInfo.messageApp !== "WhatsApp";

  let notification_text = `📢 Nouvelle${pluralHandler} publication${pluralHandler} parmi les noms que vous suivez manuellement:\n\n`;

  const keys = Array.from(updatedRecordMap.keys());
  const lastKey = keys[keys.length - 1];

  for (const peopleId of updatedRecordMap.keys()) {
    const nameUpdates = updatedRecordMap.get(peopleId);
    if (nameUpdates === undefined || nameUpdates.length === 0) {
      await logError(
        userInfo.messageApp,
        "FollowedName notification update sent with no records"
      );
      continue;
    }

    const prenomNom = nameUpdates[0].prenom + " " + nameUpdates[0].nom;

    const pluralHandlerPeople = nameUpdates.length > 1 ? "s" : "";
    notification_text += `Nouvelle${pluralHandlerPeople} publication${pluralHandlerPeople} pour ${
      markdownLinkEnabled
        ? `[${prenomNom}](${getJORFSearchLinkPeople(prenomNom)})`
        : `*${prenomNom}*`
    }\n\n`;

    notification_text += formatSearchResult(nameUpdates, markdownLinkEnabled, {
      isConfirmation: false,
      isListing: true,
      displayName: "no"
    });
    notification_text += `Vous suivez maintenant *${prenomNom}* ✅`;

    if (peopleId !== lastKey) notification_text += DEFAULT_GROUP_SEPARATOR;
  }

  const messageAppsOptionsApp: MessageSendingOptionsExternal = {
    ...messageAppsOptions,
    separateMenuMessage: userInfo.messageApp === "WhatsApp",
    useAsyncUmamiLog: true,
    hasAccount: true
  };

  const messageSent = await sendMessage(
    userInfo,
    notification_text,
    messageAppsOptionsApp
  );
  if (!messageSent) return false;

  const notifData: UmamiNotificationData = {
    message_nb: getSplitTextMessageSize(notification_text, userInfo.messageApp),
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
    event: "/notification-update-name",
    messageApp: userInfo.messageApp,
    notificationData: notifData,
    hasAccount: true
  });
  return true;
}
