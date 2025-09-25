import { ExternalMessageOptions, sendMessage } from "../entities/Session.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { IOrganisation, IUser, MessageApp, WikidataId } from "../types.ts";
import Organisation from "../models/Organisation.ts";
import User from "../models/User.ts";
import { JORFtoDate } from "../utils/date.utils.ts";
import { formatSearchResult } from "../utils/formatSearchResult.ts";
import { getJORFSearchLinkOrganisation } from "../utils/JORFSearch.utils.ts";
import umami from "../utils/umami.ts";
import { sendMainMenu } from "../commands/default.ts";
import {
  NotificationTask,
  dispatchTasksToMessageApps
} from "../utils/notificationDispatch.ts";
import {
  LeafFormatter,
  createReferenceGrouping,
  formatGroupedRecords,
  groupRecordsBy,
  SeparatorSelector
} from "./grouping.ts";

const DEFAULT_GROUP_SEPARATOR = "====================\n\n";
const DEFAULT_SUBGROUP_SEPARATOR = "\n--------------------\n\n";

const organisationReferenceGrouping = createReferenceGrouping({
  omitOrganisationNames: true
});

const organisationLeafFormatter: LeafFormatter = (
  records,
  markdownEnabled,
  config
) =>
  formatSearchResult(records, markdownEnabled, {
    isConfirmation: false,
    isListing: true,
    displayName: "all",
    omitOrganisationNames: config.omitOrganisationNames ?? false,
    omitReference: true
  });

const organisationSeparatorSelector: SeparatorSelector = () =>
  DEFAULT_SUBGROUP_SEPARATOR;

export async function notifyOrganisationsUpdates(
  allUpdatedRecords: JORFSearchItem[],
  enabledApps: MessageApp[],
  messageAppsOptions: ExternalMessageOptions
) {
  const updatedOrgsWikidataIdSet = new Set<WikidataId>(
    allUpdatedRecords
      .flatMap((r) => r.organisations)
      .map((o) => o.wikidata_id)
      .filter((id): id is WikidataId => !!id)
  );
  if (updatedOrgsWikidataIdSet.size === 0) return;

  const updatedOrgsInDb: IOrganisation[] = await Organisation.find({
    wikidataId: { $in: [...updatedOrgsWikidataIdSet] }
  }).lean();
  if (updatedOrgsInDb.length === 0) return;

  const usersFollowingOrganisations: IUser[] = await User.find(
    {
      followedOrganisations: {
        $exists: true,
        $not: { $size: 0 },
        $elemMatch: {
          wikidataId: {
            $in: updatedOrgsInDb.map((o) => o.wikidataId)
          }
        }
      },
      status: "active",
      messageApp: { $in: enabledApps }
    },
    {
      _id: 1,
      chatId: 1,
      messageApp: 1,
      followedOrganisations: { wikidataId: 1, lastUpdate: 1 },
      schemaVersion: 1
    }
  ).lean();
  if (usersFollowingOrganisations.length === 0) return;

  const orgNameById = new Map<WikidataId, string>(
    updatedOrgsInDb.map((o) => [o.wikidataId, o.nom])
  );

  const updatedRecordsWithOrgsInDb = allUpdatedRecords.filter((r) =>
    r.organisations.some(
      ({ wikidata_id }) => !!wikidata_id && orgNameById.has(wikidata_id)
    )
  );
  if (updatedRecordsWithOrgsInDb.length === 0) return;

  const updatedOrganisationsbyIdMap = new Map<WikidataId, JORFSearchItem[]>();

  updatedRecordsWithOrgsInDb.forEach((item) => {
    item.organisations.forEach(({ wikidata_id }) => {
      if (wikidata_id != undefined) {
        updatedOrganisationsbyIdMap.set(
          wikidata_id,
          (updatedOrganisationsbyIdMap.get(wikidata_id) ?? []).concat([item])
        );
      }
    });
  });

  const now = new Date();

  const userUpdateTasks: NotificationTask<WikidataId>[] = [];

  for (const user of usersFollowingOrganisations) {
    const newUserOrganisationsUpdates = new Map<WikidataId, JORFSearchItem[]>();

    user.followedOrganisations
      .filter((orgFollow) =>
        updatedOrganisationsbyIdMap.has(orgFollow.wikidataId)
      )
      .forEach((orgFollow) => {
        const dateFilteredUserOrgUpdates: JORFSearchItem[] = (
          updatedOrganisationsbyIdMap.get(orgFollow.wikidataId) ?? []
        ).filter(
          (record: JORFSearchItem) =>
            JORFtoDate(record.source_date).getTime() >
            orgFollow.lastUpdate.getTime()
        );
        if (dateFilteredUserOrgUpdates.length > 0)
          newUserOrganisationsUpdates.set(
            orgFollow.wikidataId,
            dateFilteredUserOrgUpdates
          );
      });

    let totalUserRecordsCount = 0;
    newUserOrganisationsUpdates.forEach((items) => {
      totalUserRecordsCount += items.length;
    });

    if (totalUserRecordsCount > 0)
      userUpdateTasks.push({
        userId: user._id,
        messageApp: user.messageApp,
        chatId: user.chatId,
        updatedRecordsMap: newUserOrganisationsUpdates,
        recordCount: totalUserRecordsCount
      });
  }

  if (userUpdateTasks.length === 0) return;

  await dispatchTasksToMessageApps<WikidataId>(
    userUpdateTasks,
    async (task) => {
      const messageSent = await sendOrganisationUpdate(
        task.messageApp,
        task.chatId,
        task.updatedRecordsMap,
        orgNameById,
        messageAppsOptions
      );

      if (messageSent) {
        await User.updateOne(
          {
            _id: task.userId,
            "followedOrganisations.wikidataId": {
              $in: [...task.updatedRecordsMap.keys()]
            }
          },
          { $set: { "followedOrganisations.$[elem].lastUpdate": now } },
          {
            arrayFilters: [
              {
                "elem.wikidataId": {
                  $in: [...task.updatedRecordsMap.keys()]
                }
              }
            ]
          }
        );
      }
    }
  );
}

async function sendOrganisationUpdate(
  messageApp: MessageApp,
  chatId: IUser["chatId"],
  organisationsUpdateRecordsMap: Map<WikidataId, JORFSearchItem[]>,
  orgNameById: Map<WikidataId, string>,
  messageAppsOptions: ExternalMessageOptions
): Promise<boolean> {
  if (organisationsUpdateRecordsMap.size === 0) return true;

  let notification_text =
    "📢 Nouvelles publications parmi les organisations que suivez :\n\n";

  const markdownLinkEnabled = messageApp !== "WhatsApp";

  const keys = Array.from(organisationsUpdateRecordsMap.keys());
  const lastKey = keys[keys.length - 1];

  for (const orgId of organisationsUpdateRecordsMap.keys()) {
    const orgName = orgNameById.get(orgId);
    if (orgName === undefined) {
      console.log(
        "Unable to find the name of the organisation with wikidataId " + orgId
      );
      continue;
    }
    const orgRecords = organisationsUpdateRecordsMap.get(orgId);
    if (orgRecords === undefined || orgRecords.length === 0) {
      console.log("Organisation notification update sent with no records");
      continue;
    }

    const pluralHandler = orgRecords.length > 1 ? "s" : "";
    notification_text += `Nouvelle${pluralHandler} publication${pluralHandler} pour ${
      markdownLinkEnabled
        ? `[${orgName}](${getJORFSearchLinkOrganisation(orgId)})`
        : `*${orgName}*`
    }\n\n`;

    const groupedByReference = groupRecordsBy(
      orgRecords,
      organisationReferenceGrouping
    );

    const formattedGroups = formatGroupedRecords(
      groupedByReference,
      organisationReferenceGrouping,
      markdownLinkEnabled,
      organisationLeafFormatter,
      organisationSeparatorSelector
    );

    notification_text +=
      formattedGroups.length > 0
        ? formattedGroups
        : formatSearchResult(orgRecords, markdownLinkEnabled, {
            isConfirmation: false,
            isListing: true,
            displayName: "all",
            omitOrganisationNames: true
          });

    if (orgId !== lastKey) notification_text += DEFAULT_GROUP_SEPARATOR;
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

  await umami.log({ event: "/notification-update-organisation" });
  return true;
}
