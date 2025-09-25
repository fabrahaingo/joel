import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import { ExternalMessageOptions, sendMessage } from "../entities/Session.ts";
import { IUser, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import { JORFtoDate } from "../utils/date.utils.ts";
import { formatSearchResult } from "../utils/formatSearchResult.ts";
import { getJORFSearchLinkFunctionTag } from "../utils/JORFSearch.utils.ts";
import umami from "../utils/umami.ts";
import { sendMainMenu } from "../commands/default.ts";
import {
  NotificationTask,
  dispatchTasksToMessageApps
} from "../utils/notificationDispatch.ts";

const DEFAULT_GROUP_SEPARATOR = "====================\n\n";
const DEFAULT_SUBGROUP_SEPARATOR = "--------------------\n\n";

const tagValues = Object.values(FunctionTags);
const tagKeys = Object.keys(FunctionTags);

type GroupIdentifier = string | string[] | null | undefined;

interface NotificationGroupingConfig {
  getGroupId: (record: JORFSearchItem) => GroupIdentifier;
  fallbackLabel?: string;
  formatGroupTitle?: (options: {
    groupId: string;
    markdownLinkEnabled: boolean;
  }) => string;
  sortGroupIds?: (groupIds: string[]) => string[];
  omitOrganisationNames?: boolean;
}

const CABINET_GROUP_FALLBACK_LABEL = "Autres ministères";

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
    }
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

    const groupingConfig = functionTagGroupingStrategies[tag];
    let handledByGrouping = false;

    if (groupingConfig) {
      const groupedMap = groupRecordsBy(tagRecords, groupingConfig);
      const orderedEntries = orderGroupedEntries(
        groupedMap,
        groupingConfig.sortGroupIds
      ).filter(([, records]) => records.length > 0);

      if (orderedEntries.length > 0) {
        handledByGrouping = true;

        orderedEntries.forEach(([groupId, groupRecords], groupIndex) => {
          const groupTitle =
            groupingConfig.formatGroupTitle?.({
              groupId,
              markdownLinkEnabled
            }) ?? `👉 ${groupId}\n\n`;

          notification_text += groupTitle;

          notification_text += formatSearchResult(
            groupRecords,
            markdownLinkEnabled,
            {
              isConfirmation: false,
              isListing: true,
              displayName: "all",
              omitOrganisationNames:
                groupingConfig.omitOrganisationNames ?? false
            }
          );

          const isLastGroup = groupIndex === orderedEntries.length - 1;
          if (!isLastGroup) notification_text += DEFAULT_SUBGROUP_SEPARATOR;
          else if (tag !== lastTag)
            notification_text += DEFAULT_GROUP_SEPARATOR;
        });
      }
    }

    if (handledByGrouping) continue;

    notification_text += formatSearchResult(tagRecords, markdownLinkEnabled, {
      isConfirmation: false,
      isListing: true,
      displayName: "all",
      omitOrganisationNames: groupingConfig?.omitOrganisationNames ?? false
    });

    if (tag !== lastTag) notification_text += DEFAULT_GROUP_SEPARATOR;
  }

  const messageAppsOptionsApp = {
    ...messageAppsOptions,
    forceNoKeyboard: messageApp === "WhatsApp"
  };

  const messageSent = await sendMessage(
    messageApp,
    chatId,
    notification_text,
    messageAppsOptionsApp
  );
  if (messageApp === "WhatsApp")
    await sendMainMenu(messageApp, chatId, {
      externalOptions: messageAppsOptions
    });
  if (!messageSent) return false;

  await umami.log({ event: "/notification-update-function" });
  return true;
}

function normaliseGroupId(id: string | null | undefined): string | null {
  if (id === undefined || id === null) return null;
  const trimmed = String(id).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function groupRecordsBy(
  records: JORFSearchItem[],
  config: NotificationGroupingConfig
): Map<string, JORFSearchItem[]> {
  const grouped = new Map<string, JORFSearchItem[]>();

  for (const record of records) {
    const rawGroupId = config.getGroupId(record);
    const candidateIds = Array.isArray(rawGroupId) ? rawGroupId : [rawGroupId];

    const validIds = candidateIds
      .map((value) => normaliseGroupId(value))
      .filter((value): value is string => value !== null);

    const fallbackKey = normaliseGroupId(config.fallbackLabel);
    const keysToUse =
      validIds.length > 0 ? validIds : fallbackKey ? [fallbackKey] : [];

    for (const key of keysToUse) {
      const existing = grouped.get(key) ?? [];
      existing.push(record);
      grouped.set(key, existing);
    }
  }

  return grouped;
}

function orderGroupedEntries(
  groupedMap: Map<string, JORFSearchItem[]>,
  sort?: (groupIds: string[]) => string[]
): [string, JORFSearchItem[]][] {
  const groupIds = sort ? sort([...groupedMap.keys()]) : [...groupedMap.keys()];
  return groupIds.map((groupId) => [groupId, groupedMap.get(groupId) ?? []]);
}

function createFieldGrouping(
  accessor: (record: JORFSearchItem) => GroupIdentifier,
  options?: Omit<NotificationGroupingConfig, "getGroupId">
): NotificationGroupingConfig {
  return {
    getGroupId: accessor,
    fallbackLabel: options?.fallbackLabel,
    formatGroupTitle: options?.formatGroupTitle,
    sortGroupIds: options?.sortGroupIds,
    omitOrganisationNames: options?.omitOrganisationNames
  };
}
