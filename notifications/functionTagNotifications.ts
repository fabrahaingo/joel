import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import { ExternalMessageOptions, sendMessage } from "../entities/Session.ts";
import { IUser, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import { JORFtoDate } from "../utils/date.utils.ts";
import { formatSearchResult } from "../utils/formatSearchResult.ts";
import { getJORFSearchLinkFunctionTag } from "../utils/JORFSearch.utils.ts";
import umami, { UmamiNotificationData } from "../utils/umami.ts";
import {
  NotificationTask,
  dispatchTasksToMessageApps
} from "../utils/notificationDispatch.ts";
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
  messageAppsOptions: ExternalMessageOptions
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

  const usersFollowingTags: IUser[] = await User.find(
    {
      followedFunctions: {
        $exists: true,
        $not: { $size: 0 },
        $elemMatch: {
          functionTag: { $in: [...updatedTagSet] }
        }
      },
      status: "active",
      messageApp: { $in: enabledApps }
    },
    {
      _id: 1,
      messageApp: 1,
      chatId: 1,
      followedFunctions: { functionTag: 1, lastUpdate: 1 },
      schemaVersion: 1
    }
  ).lean();
  if (usersFollowingTags.length === 0) return;

  const now = new Date();

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
        messageApp: user.messageApp,
        chatId: user.chatId,
        updatedRecordsMap: newUserTagsUpdates,
        recordCount: totalUserRecordsCount
      });
  }

  if (userUpdateTasks.length === 0) return;

  await dispatchTasksToMessageApps<FunctionTags>(
    userUpdateTasks,
    async (task) => {
      const messageSent = await sendTagUpdates(
        task.messageApp,
        task.chatId,
        task.updatedRecordsMap,
        messageAppsOptions
      );

      if (messageSent) {
        await User.updateOne(
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
      }
    }
  );
}

async function sendTagUpdates(
  messageApp: MessageApp,
  chatId: IUser["chatId"],
  tagMap: Map<FunctionTags, JORFSearchItem[]>,
  messageAppsOptions: ExternalMessageOptions
): Promise<boolean> {
  const tagList = [...tagMap.keys()];

  if (tagList.length === 0) return true;

  let notification_text =
    "📢 Nouvelles publications parmi les fonctions que suivez :\n\n";

  const markdownLinkEnabled = messageApp !== "WhatsApp";

  const tagOrder = Array.from(tagMap.keys());
  const lastTag = tagOrder[tagOrder.length - 1];

  for (const tag of tagOrder) {
    const tagRecords = tagMap.get(tag);
    if (tagRecords === undefined || tagRecords.length === 0) {
      console.log("Tag notification update sent with no records");
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

  const messageAppsOptionsApp = {
    ...messageAppsOptions,
    separateMenuMessage: true
  };

  const messageSent = await sendMessage(
    messageApp,
    chatId,
    notification_text,
    messageAppsOptionsApp
  );
  if (!messageSent) return false;

  const notifData: UmamiNotificationData = {
    message_nb: getSplitTextMessageSize(notification_text, messageApp),
    updated_follows_nb: tagMap.size,
    total_records_nb: tagMap
      .values()
      .reduce((total: number, value) => total + value.length, 0)
  };

  await umami.log("/notification-update-function", messageApp, notifData);
  return true;
}
