import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import {
  ExtendedMiniUserInfo,
  ExternalMessageOptions,
  MessageSendingOptionsExternal,
  sendMessage
} from "../entities/Session.ts";
import { IUser, JORFReference, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import {
  formatDuration,
  JORFtoDate,
  timeDaysBetweenDates
} from "../utils/date.utils.ts";
import { formatSearchResult } from "../utils/formatSearchResult.ts";
import { getJORFSearchLinkFunctionTag } from "../utils/JORFSearch.utils.ts";
import umami, { UmamiNotificationData } from "../utils/umami.ts";
import {
  NotificationTask,
  dispatchTasksToMessageApps
} from "./notificationDispatch.ts";
import {
  LeafFormatter,
  NotificationGroupingConfig,
  SeparatorSelector,
  createFieldGrouping,
  createReferenceGrouping,
  formatGroupedRecords,
  groupRecordsBy
} from "./grouping.ts";
import { getSplitTextMessageSize } from "../utils/text.utils.ts";
import { logError } from "../utils/debugLogger.ts";
import { FilterQuery, Types } from "mongoose";
import {
  sendWhatsAppTemplate,
  WHATSAPP_NEAR_MISS_WINDOW_MS,
  WHATSAPP_REENGAGEMENT_TIMEOUT_WITH_MARGIN_MS
} from "../entities/WhatsAppSession.ts";

const DEFAULT_GROUP_SEPARATOR = "====================\n\n";
const DEFAULT_SUBGROUP_SEPARATOR = "\n--------------------\n\n";
const DEFAULT_REFERENCE_SUBGROUP_SEPARATOR = "\n....................\n\n";

const tagValues = Object.values(FunctionTags);
const tagKeys = Object.keys(FunctionTags);

const CABINET_GROUP_FALLBACK_LABEL = "Autres ministères";
const DEFAULT_REFERENCE_GROUPING = createReferenceGrouping();

const formatTagLeafGroup: LeafFormatter = (records, markdownEnabled, config) =>
  formatSearchResult(records, markdownEnabled, {
    isConfirmation: false,
    isListing: true,
    displayName: "all",
    omitOrganisationNames: config.omitOrganisationNames ?? false,
    omitCabinet: true,
    omitReference: true
  });

const functionTagSeparatorSelector: SeparatorSelector = (level) =>
  level === 0
    ? DEFAULT_SUBGROUP_SEPARATOR
    : DEFAULT_REFERENCE_SUBGROUP_SEPARATOR;

const functionTagGroupingStrategies: Partial<
  Record<FunctionTags, NotificationGroupingConfig>
> = {
  ["cabinet_ministeriel"]: createFieldGrouping((record) => record.cabinet, {
    fallbackLabel: CABINET_GROUP_FALLBACK_LABEL,
    formatGroupTitle: ({ groupId }) => `🏛️ *${groupId}*\n\n`,
    sortGroupIds: (groupIds) => {
      const withoutFallback = groupIds.filter(
        (groupId) => groupId !== CABINET_GROUP_FALLBACK_LABEL
      );
      const sorted = withoutFallback.sort((a, b) =>
        a.localeCompare(b, "fr", { sensitivity: "base" })
      );
      if (groupIds.includes(CABINET_GROUP_FALLBACK_LABEL))
        sorted.push(CABINET_GROUP_FALLBACK_LABEL);
      return sorted;
    },
    subGrouping: createReferenceGrouping()
  })
};

export async function notifyFunctionTagsUpdates(
  updatedRecords: JORFSearchItem[],
  enabledApps: MessageApp[],
  messageAppsOptions: ExternalMessageOptions,
  userIds?: Types.ObjectId[],
  forceWHMessages = false
) {
  if (updatedRecords.length === 0) return;

  const functionTagValues: string[] = Object.values(FunctionTags);
  const updatedTagMap = new Map<FunctionTags, JORFSearchItem[]>();

  updatedRecords.forEach((item) => {
    (Object.keys(item) as (keyof JORFSearchItem)[]).forEach((key) => {
      if (functionTagValues.includes(key)) {
        const keyFctTag = key as FunctionTags;
        const currentItems = updatedTagMap.get(keyFctTag) ?? [];
        updatedTagMap.set(keyFctTag, [...currentItems, item]);
      }
    });
  });

  const updatedTagSet = new Set<FunctionTags>(updatedTagMap.keys());

  let dbFilters: FilterQuery<IUser> = {
    followedFunctions: {
      $exists: true,
      $not: { $size: 0 },
      $elemMatch: {
        functionTag: { $in: [...updatedTagSet] }
      }
    },
    status: "active",
    messageApp: { $in: enabledApps }
  };

  if (userIds != null) {
    if (userIds.length === 0) {
      throw new Error("Empty userIds provided to notifyFunctionTagsUpdates");
    }
    dbFilters = { ...dbFilters, _id: { $in: userIds } };
  }

  const usersFollowingTags: IUser[] = await User.find(dbFilters, {
    _id: 1,
    messageApp: 1,
    chatId: 1,
    roomId: 1,
    followedFunctions: { functionTag: 1, lastUpdate: 1 },
    schemaVersion: 1,
    waitingReengagement: 1,
    status: 1,
    lastEngagementAt: 1
  }).lean();
  if (usersFollowingTags.length === 0) return;

  const userUpdateTasks: NotificationTask<FunctionTags>[] = [];

  for (const user of usersFollowingTags) {
    const newUserTagsUpdates = new Map<FunctionTags, JORFSearchItem[]>();

    user.followedFunctions
      .filter((tagFollow) => updatedTagMap.has(tagFollow.functionTag))
      .forEach((tagFollow) => {
        const dateFilteredUserTagUpdates: JORFSearchItem[] = (
          updatedTagMap.get(tagFollow.functionTag) ?? []
        ).filter(
          (record: JORFSearchItem) =>
            JORFtoDate(record.source_date).getTime() >
            tagFollow.lastUpdate.getTime()
        );
        if (dateFilteredUserTagUpdates.length > 0)
          newUserTagsUpdates.set(
            tagFollow.functionTag,
            dateFilteredUserTagUpdates
          );
      });

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
          waitingReengagement: user.waitingReengagement,
          status: user.status,
          hasAccount: true,
          lastEngagementAt: user.lastEngagementAt
        },
        updatedRecordsMap: newUserTagsUpdates,
        recordCount: totalUserRecordsCount
      });
  }

  if (userUpdateTasks.length === 0) return;

  await dispatchTasksToMessageApps<FunctionTags>(
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
              record.source_id,
              (notificationSources.get(record.source_id) ?? 0) + 1
            );
          }
        }

        await User.insertPendingNotifications(
          task.userId,
          task.userInfo.messageApp,
          "function",
          notificationSources
        );

        if (!task.userInfo.waitingReengagement) {
          const whatsAppAPI = messageAppsOptions.whatsAppAPI;
          if (whatsAppAPI == null) {
            await logError(
              "WhatsApp",
              "Undefined messageAppsOptions.whatsAppAPI in notifyFunctionTagsUpdates"
            );
            return;
          }
          const templateSent = await sendWhatsAppTemplate(
            whatsAppAPI,
            task.userInfo,
            "function",
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
              `No waitingReengagement updated for user ${task.userId.toString()} after sending function WH template on function update`
            );
          }

          // If near miss (user engaged very recently)
          if (
            now.getTime() - task.userInfo.lastEngagementAt.getTime() <
            WHATSAPP_NEAR_MISS_WINDOW_MS
          ) {
            const miss_out_delay_ms =
              now.getTime() -
              task.userInfo.lastEngagementAt.getTime() -
              24 * 60 * 60 * 1000;
            const miss_out_delay_s = Math.floor(miss_out_delay_ms / 1000);
            await umami.logAsync({
              event: "/wh-reengagement-near-miss",
              messageApp: "WhatsApp",
              hasAccount: true,
              payload: {
                delay_s: Math.floor(
                  (now.getTime() - task.userInfo.lastEngagementAt.getTime()) /
                    1000
                ),
                notification_type: "function",
                miss_out_delay_s
              }
            });
            await logError(
              "WhatsApp",
              `WH user reengagement near-miss: 24 hour window (from ${task.userInfo.lastEngagementAt.toISOString()} to now (${now.toISOString()}), missed by ${formatDuration(miss_out_delay_ms)}`
            );
          }
        }

        /*
        // Update lastUpdate for pending notifications to avoid duplicate processing
        const updatedTags = [...task.updatedRecordsMap.keys()];
        const res = await User.updateOne(
          {
            _id: task.userId,
            "followedFunctions.functionTag": { $in: updatedTags }
          },
          { $set: { "followedFunctions.$[elem].lastUpdate": now } },
          {
            arrayFilters: [
              {
                "elem.functionTag": { $in: updatedTags }
              }
            ]
          }
        );
        if (res.modifiedCount === 0) {
          await logError(
            task.userInfo.messageApp,
            `No lastUpdate updated for user ${task.userId.toString()} after storing pending tag update notifications (WH reengagement)`
          );
        }
        */

        return;
      }

      const messageSent = await sendTagUpdates(
        task.userInfo,
        task.updatedRecordsMap,
        messageAppsOptions
      );
      if (!messageSent) return;

      const res = await User.updateOne(
        {
          _id: task.userId,
          "followedFunctions.functionTag": {
            $in: [...task.updatedRecordsMap.keys()]
          }
        },
        { $set: { "followedFunctions.$[elem].lastUpdate": now } },
        {
          arrayFilters: [
            {
              "elem.functionTag": { $in: [...task.updatedRecordsMap.keys()] }
            }
          ]
        }
      );
      if (res.modifiedCount === 0) {
        await logError(
          task.userInfo.messageApp,
          `No lastUpdate updated for user ${task.userId.toString()} after sending tag update notifications`
        );
      }
    }
  );
}

export async function sendTagUpdates(
  userInfo: ExtendedMiniUserInfo,
  tagMap: Map<FunctionTags, JORFSearchItem[]>,
  messageAppsOptions: ExternalMessageOptions
): Promise<boolean> {
  const tagList = [...tagMap.keys()];

  if (tagList.length === 0) return true;

  let notification_text =
    "📢 Nouvelles publications parmi les fonctions que suivez :\n\n";

  const markdownLinkEnabled = userInfo.messageApp !== "WhatsApp";

  const tagOrder = Array.from(tagMap.keys());
  const lastTag = tagOrder[tagOrder.length - 1];

  for (const tag of tagOrder) {
    const tagRecords = tagMap.get(tag);
    if (tagRecords === undefined || tagRecords.length === 0) {
      await logError(
        userInfo.messageApp,
        "Tag notification update sent with no records"
      );
      continue;
    }
    const tagKey = tagKeys[tagValues.indexOf(tag)];

    const pluralHandler = tagRecords.length > 1 ? "s" : "";
    notification_text += `Nouvelle${pluralHandler} publication${pluralHandler} pour la fonction ${
      markdownLinkEnabled
        ? `[${tagKey}](${getJORFSearchLinkFunctionTag(tag)})`
        : `*${tagKey}*`
    }\n\n`;

    const groupingConfig =
      functionTagGroupingStrategies[tag] ?? DEFAULT_REFERENCE_GROUPING;

    const groupedMap = groupRecordsBy(tagRecords, groupingConfig);

    const formattedGroups = formatGroupedRecords(
      groupedMap,
      groupingConfig,
      markdownLinkEnabled,
      formatTagLeafGroup,
      functionTagSeparatorSelector
    );

    if (formattedGroups.length > 0) notification_text += formattedGroups;
    else
      notification_text += formatSearchResult(tagRecords, markdownLinkEnabled, {
        isConfirmation: false,
        isListing: true,
        displayName: "all",
        omitOrganisationNames: groupingConfig.omitOrganisationNames ?? false
      });

    if (tag !== lastTag) notification_text += DEFAULT_GROUP_SEPARATOR;
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
    updated_follows_nb: tagMap.size,
    total_records_nb: tagMap
      .values()
      .reduce((total: number, value) => total + value.length, 0),
    last_engagement_delay_days: timeDaysBetweenDates(
      userInfo.lastEngagementAt,
      new Date()
    )
  };

  await umami.logAsync({
    event: "/notification-update-function",
    messageApp: userInfo.messageApp,
    notificationData: notifData,
    hasAccount: true
  });
  return true;
}
