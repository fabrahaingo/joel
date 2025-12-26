import { FilterQuery, Types } from "mongoose";
import {
  ExtendedMiniUserInfo,
  ExternalMessageOptions,
  MessageSendingOptionsExternal,
  sendMessage
} from "../entities/Session.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { IPeople, IUser, JORFReference, MessageApp } from "../types.ts";
import People from "../models/People.ts";
import User from "../models/User.ts";
import umami, { UmamiNotificationData } from "../utils/umami.ts";
import { JORFtoDate, timeDaysBetweenDates } from "../utils/date.utils.ts";
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
  WHATSAPP_REENGAGEMENT_TIMEOUT_MS
} from "../entities/WhatsAppSession.ts";

const DEFAULT_GROUP_SEPARATOR = "\n====================\n\n";

export async function notifyPeopleUpdates(
  updatedRecords: JORFSearchItem[],
  enabledApps: MessageApp[],
  messageAppsOptions: ExternalMessageOptions,
  userIds?: Types.ObjectId[],
  forceWHMessages = false
) {
  if (updatedRecords.length === 0) return;

  const peopleJSONSet = new Set<string>();
  updatedRecords.forEach((person) => {
    peopleJSONSet.add(
      JSON.stringify({ nom: person.nom, prenom: person.prenom })
    );
  });

  const byPrenom = [...peopleJSONSet]
    .map((i) => JSON.parse(i) as { nom: string; prenom: string })
    .reduce(
      (acc: Record<string, { nom: string; prenom: string }[]>, person) => {
        acc[person.prenom] = (acc[person.prenom] ??= []).concat([person]);
        return acc;
      },
      {}
    );

  const filtersbyPrenom = Object.entries(byPrenom).map(([prenom, arr]) => ({
    prenom,
    nom: { $in: arr.map((a) => a.nom) }
  }));

  const updatedPeopleList: IPeople[] = await People.find({
    $or: filtersbyPrenom
  })
    .collation({ locale: "fr", strength: 2 })
    .lean();
  if (updatedPeopleList.length === 0) return;

  let dbFilters: FilterQuery<IUser> = {
    followedPeople: {
      $elemMatch: {
        peopleId: {
          $in: updatedPeopleList.map((i) => i._id)
        }
      }
    },
    status: "active",
    messageApp: { $in: enabledApps }
  };

  if (userIds != null) {
    if (userIds.length === 0) {
      throw new Error("Empty userIds provided to notifyPeopleUpdates");
    }
    dbFilters = { ...dbFilters, _id: { $in: userIds } };
  }

  const usersFollowingPeople: IUser[] = await User.find(dbFilters, {
    _id: 1,
    messageApp: 1,
    chatId: 1,
    roomId: 1,
    followedPeople: { peopleId: 1, lastUpdate: 1 },
    schemaVersion: 1,
    status: 1,
    waitingReengagement: 1,
    lastEngagementAt: 1
  }).lean();
  if (usersFollowingPeople.length === 0) return;

  const cleanPeopleInfo = updatedPeopleList.map((p) => ({
    prenom: cleanPeopleName(p.prenom),
    nom: cleanPeopleName(p.nom)
  }));

  const updatedPeoplebyIdMap = new Map<string, JORFSearchItem[]>();

  updatedRecords.forEach((item) => {
    const peopleIdx = cleanPeopleInfo.findIndex(
      (p) =>
        p.nom === cleanPeopleName(item.nom) &&
        p.prenom === cleanPeopleName(item.prenom)
    );
    if (peopleIdx !== -1) {
      updatedPeoplebyIdMap.set(
        updatedPeopleList[peopleIdx]._id.toString(),
        (
          updatedPeoplebyIdMap.get(
            updatedPeopleList[peopleIdx]._id.toString()
          ) ?? []
        ).concat([item])
      );
    }
  });

  const userUpdateTasks: NotificationTask<string>[] = [];

  const peopleIdMapByStr = new Map<string, Types.ObjectId>();
  updatedPeopleList.forEach((p) => {
    peopleIdMapByStr.set(p._id.toString(), p._id);
  });

  for (const user of usersFollowingPeople) {
    const newUserPeopleUpdates = new Map<string, JORFSearchItem[]>();

    user.followedPeople
      .filter((peopleFollow) =>
        peopleIdMapByStr.has(peopleFollow.peopleId.toString())
      )
      .forEach((peopleFollow) => {
        const dateFilteredUserOrgUpdates: JORFSearchItem[] = (
          updatedPeoplebyIdMap.get(peopleFollow.peopleId.toString()) ?? []
        ).filter(
          (record: JORFSearchItem) =>
            JORFtoDate(record.source_date).getTime() >
            peopleFollow.lastUpdate.getTime()
        );
        if (dateFilteredUserOrgUpdates.length > 0)
          newUserPeopleUpdates.set(
            peopleFollow.peopleId.toString(),
            dateFilteredUserOrgUpdates
          );
      });

    let totalUserRecordsCount = 0;
    newUserPeopleUpdates.forEach((items) => {
      totalUserRecordsCount += items.length;
    });

    if (totalUserRecordsCount > 0)
      userUpdateTasks.push({
        userId: user._id,
        userInfo: {
          messageApp: user.messageApp,
          chatId: user.chatId,
          roomId: user.roomId,
          waitingReengagement: user.waitingReengagement,
          status: user.status,
          hasAccount: true,
          lastEngagementAt: user.lastEngagementAt
        },
        updatedRecordsMap: newUserPeopleUpdates,
        recordCount: totalUserRecordsCount
      });
  }

  if (userUpdateTasks.length === 0) return;

  await dispatchTasksToMessageApps<string>(userUpdateTasks, async (task) => {
    const now = new Date();

    const reengagementExpired =
      now.getTime() - task.userInfo.lastEngagementAt.getTime() >
      WHATSAPP_REENGAGEMENT_TIMEOUT_MS;

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
        "people",
        notificationSources
      );

      if (!task.userInfo.waitingReengagement) {
        const whatsAppAPI = messageAppsOptions.whatsAppAPI;
        if (whatsAppAPI == null) {
          await logError(
            "WhatsApp",
            "Undefined messageAppsOptions.whatsAppAPI in notifyPeopleUpdates"
          );
          return;
        }
        const templateSent = await sendWhatsAppTemplate(
          whatsAppAPI,
          task.userInfo,
          "people",
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
            `No waitingReengagement updated for user ${task.userId.toString()} after sending WH template on people update`
          );
        }
      }

      return;
    }

    const messageSent = await sendPeopleUpdate(
      task.userInfo,
      task.updatedRecordsMap,
      messageAppsOptions
    );
    if (!messageSent) return;

    const updatedRecordsPeopleId = [...task.updatedRecordsMap.keys()]
      .map((idStr) => peopleIdMapByStr.get(idStr))
      .reduce((tab: Types.ObjectId[], id) => {
        if (id === undefined) {
          console.log(
            "Cannot fetch people id from string during the update of user people follows"
          );
          return tab;
        }
        return tab.concat(id);
      }, []);

    const res = await User.updateOne(
      {
        _id: task.userId,
        "followedPeople.peopleId": {
          $in: updatedRecordsPeopleId
        }
      },
      { $set: { "followedPeople.$[elem].lastUpdate": now } },
      {
        arrayFilters: [
          {
            "elem.peopleId": { $in: updatedRecordsPeopleId }
          }
        ]
      }
    );
    if (res.modifiedCount === 0) {
      await logError(
        task.userInfo.messageApp,
        `No lastUpdate updated for user ${task.userId.toString()} after sending people update notifications`
      );
    }
  });
}

export async function sendPeopleUpdate(
  userInfo: ExtendedMiniUserInfo,
  updatedRecordMap: Map<string, JORFSearchItem[]>,
  messageAppsOptions: ExternalMessageOptions
) {
  if (updatedRecordMap.size === 0) return true;

  const pluralHandler = updatedRecordMap.size > 1 ? "s" : "";

  const markdownLinkEnabled = userInfo.messageApp !== "WhatsApp";

  let notification_text = `📢 Nouvelle${pluralHandler} publication${pluralHandler} parmi les personnes que vous suivez :\n\n`;

  const keys = Array.from(updatedRecordMap.keys());
  const lastKey = keys[keys.length - 1];

  for (const peopleId of updatedRecordMap.keys()) {
    const peopleRecords = updatedRecordMap.get(peopleId);
    if (peopleRecords === undefined || peopleRecords.length === 0) {
      await logError(
        userInfo.messageApp,
        "FollowedPeople notification update sent with no records"
      );
      continue;
    }

    const prenomNom = peopleRecords[0].prenom + " " + peopleRecords[0].nom;

    const pluralHandlerPeople = peopleRecords.length > 1 ? "s" : "";
    notification_text += `Nouvelle${pluralHandlerPeople} publication${pluralHandlerPeople} pour ${
      markdownLinkEnabled
        ? `[${prenomNom}](${getJORFSearchLinkPeople(prenomNom)})`
        : `*${prenomNom}*`
    }\n\n`;

    notification_text += formatSearchResult(
      peopleRecords,
      markdownLinkEnabled,
      {
        isConfirmation: false,
        isListing: true,
        displayName: "no"
      }
    );

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
    event: "/notification-update-people",
    messageApp: userInfo.messageApp,
    notificationData: notifData,
    hasAccount: true
  });
  return true;
}
