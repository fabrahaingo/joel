import "dotenv/config";
import { mongodbConnect } from "../db.js";
import { ErrorMessages } from "../entities/ErrorMessages.js";
import { JORFSearchItem } from "../entities/JORFSearchResponse.js";
import { FunctionTags } from "../entities/FunctionTags.js";
import { IPeople, IUser, WikidataId } from "../types.js";
import People from "../models/People.js";
import axios, { AxiosError, isAxiosError } from "axios";
import Blocked from "../models/Blocked.js";
import User from "../models/User.js";
import { ChatId } from "node-telegram-bot-api";
import { Types } from "mongoose";
import umami from "../utils/umami.js";
import { dateTOJORFFormat, JORFtoDate } from "../utils/date.utils.js";
import { splitText } from "../utils/text.utils.js";
import { formatSearchResult } from "../utils/formatSearchResult.js";
import {
  callJORFSearchDay,
  cleanPeopleName,
  uniqueMinimalNameInfo
} from "../utils/JORFSearch.utils.js";
import Organisation from "../models/Organisation.js";

const BOT_TOKEN = process.env.BOT_TOKEN;

// Check that the BOT TOKEN is set: to prevent computing everything for nothing ...
if (BOT_TOKEN === undefined) {
  throw new Error(ErrorMessages.TELEGRAM_BOT_TOKEN_NOT_SET);
}

async function getJORFRecordsFromDate(
  startDate: Date
): Promise<JORFSearchItem[]> {
  const todayDate = new Date();

  // In place operations
  startDate.setHours(0, 0, 0, 0);
  todayDate.setHours(0, 0, 0, 0);

  const targetDateStr = dateTOJORFFormat(startDate);

  // From today, until the start
  // Order is important to keep record sorted and remove later ones as duplicates
  let updatedPeople: JORFSearchItem[] = [];

  const currentDate = new Date(todayDate);
  let running = true;
  while (running) {
    const JORFPeople: JORFSearchItem[] = await callJORFSearchDay(currentDate);

    updatedPeople = updatedPeople.concat(JORFPeople);
    running = dateTOJORFFormat(currentDate) !== targetDateStr;
    currentDate.setDate(currentDate.getDate() - 1);
  }
  return updatedPeople;
}

function extractTaggedItems(
  JORF_items: JORFSearchItem[],
  tagName: FunctionTags,
  tagValue?: string
) {
  if (tagValue === undefined) {
    return JORF_items.filter(
      (item) => Object.prototype.hasOwnProperty.call(item, tagName) // Check if item has tag as a field
    );
  } else {
    return JORF_items.filter(
      (item) =>
        Object.prototype.hasOwnProperty.call(item, tagName) && // Check if item has tag as a field
        item[tagName as keyof JORFSearchItem] === tagValue // Check if the tag has the required value
    );
  }
}

export function buildTagMap(
  updatedRecords: JORFSearchItem[],
  tagList: FunctionTags[]
) {
  return tagList.reduce(
    (tagMap: Record<FunctionTags, JORFSearchItem[]>, tag) => {
      // extracts the relevant tags from the daily updates
      const taggedItems = extractTaggedItems(updatedRecords, tag);
      if (taggedItems.length === 0) return tagMap; // If no tagged record: we drop the tag

      // format: {tag: [contacts], tag2: [contacts]}
      tagMap[tag] = taggedItems;
      return tagMap;
    },
    {} as Record<FunctionTags, JORFSearchItem[]>
  );
}

export function buildOrganisationMapById(
  updatedRecords: JORFSearchItem[],
  orgsInDbId: WikidataId[]
): Record<WikidataId, JORFSearchItem[]> {
  return updatedRecords.reduce(
    (orgMap: Record<WikidataId, JORFSearchItem[]>, item) => {
      const itemUniqueOrgIds: WikidataId[] = item.organisations.reduce(
        (idTab: WikidataId[], o) => {
          if (
            o.wikidata_id === undefined ||
            !orgsInDbId.includes(o.wikidata_id) ||
            idTab.some((id) => id === o.wikidata_id)
          )
            return idTab;

          idTab.push(o.wikidata_id);
          return idTab;
        },
        []
      );

      for (const wikiId of itemUniqueOrgIds) {
        orgMap[wikiId] ??= [];
        orgMap[wikiId].push(item);
      }
      return orgMap;
    },
    {} as Record<FunctionTags, JORFSearchItem[]>
  );
}

async function filterOutBlockedUsers(users: IUser[]): Promise<IUser[]> {
  const blockedUsers: IUser[] = await Blocked.find({}, { _id: 1 });
  for (const blockedUser of blockedUsers) {
    users = users.filter((user) => user._id === blockedUser._id);
  }
  return users;
}

// Update the timestamp of the last update date for a user-specific people follow
async function updateUserFollowedPeople(
  user: IUser,
  updatedPeopleIds: Types.ObjectId[]
) {
  if (updatedPeopleIds.length == 0) {
    return;
  }

  const currentDate = new Date();

  user.followedPeople = user.followedPeople.reduce(
    (
      followedList: IUser["followedPeople"],
      followed: { peopleId: Types.ObjectId; lastUpdate: Date }
    ) => {
      if (
        followedList.some(
          (f) =>
            (f.peopleId as Types.ObjectId).toString() ===
            followed.peopleId.toString()
        )
      )
        return followedList; // If the user follows twice the same person, we drop the second record

      // if updated people: we update the timestamp
      if (
        updatedPeopleIds.some(
          (p) => p._id.toString() === followed.peopleId.toString()
        )
      ) {
        followedList.push({
          peopleId: followed.peopleId,
          lastUpdate: currentDate
        });
      } else {
        followedList.push(followed); // otherwise, we don't change the item
      }
      return followedList;
    },
    []
  );

  // save user
  await user.save();
}

// Update the timestamp of the last update date for a user-specific organisation follow
async function updateUserFollowedOrganisation(
  user: IUser,
  updatedOrgIds: WikidataId[]
) {
  if (
    updatedOrgIds.length == 0 ||
    user.followedOrganisations === undefined ||
    user.followedOrganisations.length == 0
  ) {
    return;
  }

  const currentDate = new Date();

  user.followedOrganisations = user.followedOrganisations.reduce(
    (
      followedList: { wikidataId: WikidataId; lastUpdate: Date }[],
      followed
    ) => {
      if (followedList.some((f) => f.wikidataId === followed.wikidataId))
        return followedList; // If the user follows twice the same organisation, we drop the second record

      // if updated people: we update the timestamp
      if (updatedOrgIds.includes(followed.wikidataId)) {
        followedList.push({
          wikidataId: followed.wikidataId,
          lastUpdate: currentDate
        });
      } else {
        followedList.push(followed); // otherwise, we don't change the item
      }
      return followedList;
    },
    []
  );

  // save user
  await user.save();
}

// There is currently no way to check if a user has been notified of a tag update
// Resuming an update thus require to force-notify users for all tags updates over the period.
export async function notifyFunctionTagsUpdates(
  updatedRecords: JORFSearchItem[]
) {
  const updatedTagMap = buildTagMap(
    updatedRecords,
    Object.values(FunctionTags) as FunctionTags[]
  );
  const updatedTagList = Object.keys(updatedTagMap) as FunctionTags[];

  const usersFollowingTags: IUser[] = await User.find(
    {
      followedFunctions: {
        $elemMatch: {
          $in: updatedTagList
        }
      }
    },
    {
      _id: 1,
      chatId: 1,
      followedFunctions: 1
    }
  ).then(async (res: IUser[]) => {
    return await filterOutBlockedUsers(res);
  });

  for (const user of usersFollowingTags) {
    // send tqg notification to the user
    await sendTagUpdates(user, updatedTagMap);
  }
}

interface miniOrg {
  nom: string;
  wikidataId: string;
}

// There is currently no way to check if a user has been notified of a tag update
// Resuming an update thus require to force-notify users for all tags updates over the period.
export async function notifyOrganisationsUpdates(
  updatedRecords: JORFSearchItem[]
) {
  const orgsInDb: miniOrg[] = await Organisation.find(
    {},
    { wikidataId: 1 }
  ).then((orgs) => orgs.map((o) => ({ nom: o.nom, wikidataId: o.wikidataId })));
  const orgsInDbIds: WikidataId[] = orgsInDb.map((o) => o.wikidataId);

  const updatedOrganisationMapById = buildOrganisationMapById(
    updatedRecords,
    orgsInDbIds
  );

  const usersFollowingOrganisations: IUser[] = await User.find(
    {
      followedOrganisations: {
        $exists: true,
        $not: { $size: 0 },
        $elemMatch: {
          wikidataId: {
            $in: Object.keys(updatedOrganisationMapById)
          }
        }
      }
    },
    {
      _id: 1,
      chatId: 1,
      followedOrganisations: { wikidataId: 1, lastUpdate: 1 }
    }
  ).then(async (res: IUser[]) => {
    return await filterOutBlockedUsers(res);
  });

  for (const user of usersFollowingOrganisations) {
    if (
      user.followedOrganisations === undefined ||
      user.followedOrganisations.length == 0
    )
      continue;

    // Records which are associated with followed Organisations, and which are new for the respective People follow
    const orgsFollowedByUserAndUpdatedMap = user.followedOrganisations.reduce(
      (orgTabList: Record<WikidataId, JORFSearchItem[]>, followData) => {
        if (
          updatedOrganisationMapById[followData.wikidataId] === undefined ||
          updatedOrganisationMapById[followData.wikidataId].length == 0
        )
          return orgTabList;

        const newRecordsFollowedB = updatedOrganisationMapById[
          followData.wikidataId
        ].filter(
          (record) =>
            JORFtoDate(record.source_date).getTime() >
            followData.lastUpdate.getTime()
        );

        if (newRecordsFollowedB.length > 0)
          orgTabList[followData.wikidataId] = newRecordsFollowedB;

        return orgTabList;
      },
      {}
    );

    // send follow notification to the user
    await sendOrganisationUpdate(
      user,
      orgsFollowedByUserAndUpdatedMap,
      orgsInDb
    );

    // update each lastUpdate fields of the user followedPeople
    await updateUserFollowedOrganisation(
      user,
      Object.keys(orgsFollowedByUserAndUpdatedMap)
    );
  }
}

export async function notifyPeopleUpdates(updatedRecords: JORFSearchItem[]) {
  const updatedPeopleList: IPeople[] = await People.find({
    $or: uniqueMinimalNameInfo(updatedRecords)
  });

  // Fetch all users following at least one of the updated People
  const updatedUsers: IUser[] = await User.find(
    {
      followedPeople: {
        $elemMatch: {
          peopleId: {
            $in: updatedPeopleList.map((i) => i._id as Types.ObjectId)
          }
        }
      }
    },
    {
      _id: 1,
      chatId: 1,
      followedPeople: { peopleId: 1, lastUpdate: 1 }
    }
  ).then(async (res: IUser[]) => {
    return await filterOutBlockedUsers(res); // filter out users who blocked JOEL
  });

  for (const user of updatedUsers) {
    // Ids of all people followed by the user
    const peopleIdStrsFollowedByUser = user.followedPeople.map((j) =>
      (j.peopleId as Types.ObjectId).toString()
    );
    const peopleFollowedByUser = updatedPeopleList.filter((i) =>
      peopleIdStrsFollowedByUser.includes((i._id as Types.ObjectId).toString())
    );
    const peopleInfoFollowedByUser =
      uniqueMinimalNameInfo(peopleFollowedByUser);

    // Records which are associated with followed People, and which are new for the respective People follow
    const newRecordsFollowedByUser = updatedRecords.reduce(
      (recordList: JORFSearchItem[], record) => {
        // remove records not associated with followed people
        // this is the first main filter
        if (
          !peopleInfoFollowedByUser.some(
            (p) => p.nom === record.nom && p.prenom === record.prenom
          )
        )
          return recordList;

        const updatedPeople: IPeople | undefined = peopleFollowedByUser.find(
          (i) => i.nom === record.nom && i.prenom === record.prenom
        );
        if (updatedPeople == null) return recordList; // this should not happen

        // Find the follow data associated with these people record
        const followData = user.followedPeople.find(
          (i) => i.peopleId === (updatedPeople._id as Types.ObjectId).toString()
        );
        if (followData === undefined) return recordList; // this should not happen

        // Check that the update is newer than the lastUpdate
        if (
          JORFtoDate(record.source_date).getTime() <
          followData.lastUpdate.getTime()
        )
          return recordList;

        // Record up to this point associated with a followed People and newer than the last update
        recordList.push(record);
        return recordList;
      },
      []
    );

    // send follow notification to the user
    await sendPeopleUpdate(user, newRecordsFollowedByUser);

    // Ids of updated peoples:
    const updatedRecordsPeopleId: Types.ObjectId[] = peopleFollowedByUser
      .filter((p) =>
        newRecordsFollowedByUser.some(
          (r) => r.nom === p.nom && r.prenom === p.prenom
        )
      )
      .map((p) => p._id as Types.ObjectId);

    // update each lastUpdate fields of the user followedPeople
    await updateUserFollowedPeople(user, updatedRecordsPeopleId);
  }
}

export async function notifyNameMentionUpdates(
  updatedRecords: JORFSearchItem[]
) {
  const userFollowingNames: IUser[] = await User.find(
    {
      followedNames: { $exists: true, $not: { $size: 0 } }
    },
    {
      _id: 1,
      chatId: 1,
      followedNames: 1,
      followedPeople: { peopleId: 1, lastUpdate: 1 }
    }
  ).then(async (res: IUser[]) => {
    return await filterOutBlockedUsers(res); // filter out users who blocked JOEL
  });

  const recordsNamesTab = updatedRecords.reduce(
    (
      tab: {
        nomPrenomClean: string;
        prenomNomClean: string;
        nom: string;
        prenom: string;
        peopleItems: JORFSearchItem[];
      }[],
      item
    ) => {
      if (tab.some((p) => p.nom === item.nom && p.prenom === item.prenom))
        return tab;
      const peopleItems = updatedRecords.filter(
        (p) => p.nom === item.nom && p.prenom === item.prenom
      );
      tab.push({
        nomPrenomClean: cleanPeopleName(
          `${item.nom} ${item.prenom}`
        ).toUpperCase(),
        prenomNomClean: cleanPeopleName(
          `${item.prenom} ${item.nom}`
        ).toUpperCase(),
        nom: item.nom,
        prenom: item.prenom,
        peopleItems
      });
      return tab;
    },
    []
  );

  const isPersonAlreadyFollowed = (
    person: IPeople,
    followedPeople: { peopleId: Types.ObjectId; lastUpdate: Date }[]
  ) => {
    return followedPeople.some((followedPerson) => {
      return (
        followedPerson.peopleId.toString() ===
        (person._id as Types.ObjectId).toString()
      );
    });
  };

  for (const user of userFollowingNames) {
    const nameUpdates: {
      followedName: string;
      people: IPeople;
      nameJORFRecords: JORFSearchItem[];
    }[] = [];

    user.followedNames ??= [];

    for (const followedName of user.followedNames) {
      const followedNameCleaned = cleanPeopleName(followedName).toUpperCase();

      const mention = recordsNamesTab.find(
        (i) =>
          i.nomPrenomClean === followedNameCleaned ||
          i.prenomNomClean === followedNameCleaned
      );
      if (mention === undefined) continue;

      user.followedNames = user.followedNames.filter((p) => p !== followedName);

      if (
        nameUpdates.some(
          (p) =>
            p.people.nom == mention.nom && p.people.prenom == mention.prenom
        )
      )
        continue;

      const people = await People.firstOrCreate({
        nom: mention.nom,
        prenom: mention.prenom
      });

      nameUpdates.push({
        followedName,
        people,
        nameJORFRecords: mention.peopleItems
      });

      if (!isPersonAlreadyFollowed(people, user.followedPeople)) {
        user.followedPeople.push({
          peopleId: people._id as Types.ObjectId,
          lastUpdate: new Date(Date.now())
        });
      }
    }

    await sendNameMentionUpdate(
      user,
      nameUpdates.map((i) => ({
        people: i.people,
        updateItems: i.nameJORFRecords
      }))
    );

    await user.save();
  }
}

async function sendNameMentionUpdate(
  user: IUser,
  nameUpdates: { people: IPeople; updateItems: JORFSearchItem[] }[]
) {
  if (nameUpdates.length == 0) {
    return;
  }

  // Reverse array change order of records
  //updatedRecords.reverse();

  const pluralHandler = nameUpdates.length > 1 ? "s" : "";

  let notification_text = `📢 Nouvelle${pluralHandler} publication${pluralHandler} parmi les noms que vous suivez manuellement:\n\n`;

  for (let i = 0; i < nameUpdates.length; i++) {
    notification_text += formatSearchResult(nameUpdates[i].updateItems, {
      isConfirmation: false,
      isListing: true,
      displayName: "first"
    });
    notification_text += `Vous suivez maintenant *${nameUpdates[i].people.prenom} ${nameUpdates[i].people.nom}* ✅`;
    if (i < nameUpdates.length - 1) notification_text += "\n\n";
  }

  await sendLongMessageFromAxios(user, notification_text);

  await umami.log({ event: "/notification-update-name" });
}

async function sendPeopleUpdate(user: IUser, updatedRecords: JORFSearchItem[]) {
  const nbPersonUpdated = uniqueMinimalNameInfo(updatedRecords).length;

  if (nbPersonUpdated == 0) {
    return;
  }

  // Reverse array change order of records
  //updatedRecords.reverse();

  const pluralHandler = updatedRecords.length > 1 ? "s" : "";

  let notification_text = `📢 Nouvelle${pluralHandler} publication${pluralHandler} parmi les personnes que vous suivez :\n\n`;
  notification_text += formatSearchResult(updatedRecords, {
    isConfirmation: false,
    isListing: true,
    displayName: "all"
  });

  await sendLongMessageFromAxios(user, notification_text);

  await umami.log({ event: "/notification-update-people" });
}

async function sendOrganisationUpdate(
  user: IUser,
  orgMap: Record<WikidataId, JORFSearchItem[]>,
  orgsInDbIds: miniOrg[]
) {
  const orgsUpdated = Object.keys(orgMap);
  if (orgsUpdated.length == 0) return;

  let notification_text =
    "📢 Nouvelles publications parmi les organisations que suivez :\n\n";

  for (const orgId of orgsUpdated) {
    const orgName = orgsInDbIds.find((o) => o.wikidataId === orgId)?.nom;
    if (orgName === undefined) {
      console.log(
        "Unable to find the name of the organisation with wikidataId " + orgId
      );
      continue;
    }

    const orgRecords = orgMap[orgId];
    // Reverse array change order of records
    // updatedRecords.reverse();

    const pluralHandler = orgRecords.length > 1 ? "s" : "";
    notification_text += `Nouvelle${pluralHandler} publication${pluralHandler} pour *${orgName}*\n\n`;

    notification_text += formatSearchResult(orgRecords, {
      isConfirmation: false,
      isListing: true,
      displayName: "all"
    });

    if (orgsUpdated.indexOf(orgId) + 1 !== orgsUpdated.length)
      notification_text += "====================\n\n";

    notification_text += "\n";
  }

  await sendLongMessageFromAxios(user, notification_text);

  await umami.log({ event: "/notification-update-organisation" });
}

async function sendTagUpdates(
  user: IUser,
  tagMap: Record<FunctionTags, JORFSearchItem[]>
) {
  // only keep the tags followed by the user
  const tagList = (Object.keys(tagMap) as FunctionTags[]).filter((tag) =>
    user.followedFunctions.includes(tag)
  );

  if (tagList.length == 0) {
    return;
  }

  let notification_text =
    "📢 Nouvelles publications parmi les fonctions que suivez :\n\n";

  // We preload the tag keys and values to reduce search time
  const tagValues = Object.values(FunctionTags);
  const tagKeys = Object.keys(FunctionTags);

  for (const tagValue of tagList) {
    const tagKey = tagKeys[tagValues.indexOf(tagValue)];

    const tagRecords: JORFSearchItem[] = tagMap[tagValue];
    // Reverse array change order of records
    // updatedRecords.reverse();

    const pluralHandler = tagRecords.length > 1 ? "s" : "";
    notification_text += `Nouvelle${pluralHandler} publication${pluralHandler} pour la fonction *${tagKey}*\n\n`;

    notification_text += formatSearchResult(tagRecords, {
      isConfirmation: false,
      isListing: true,
      displayName: "all"
    });

    if (tagList.indexOf(tagValue) + 1 !== tagList.length)
      notification_text += "====================\n\n";

    notification_text += "\n";
  }

  await sendLongMessageFromAxios(user, notification_text);

  await umami.log({ event: "/notification-update-function" });
}

// Extend the AxiosError with the response.data.description field
export interface TelegramAPIError {
  message: string;
  status: number;
  description?: string;
}

async function sendLongMessageFromAxios(user: IUser, message: string) {
  const messagesArray = splitText(message, 3000);

  if (BOT_TOKEN === undefined) {
    throw new Error(ErrorMessages.TELEGRAM_BOT_TOKEN_NOT_SET);
  }

  for (const message of messagesArray) {
    await axios
      .post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: user.chatId as ChatId,
        text: message,
        parse_mode: "markdown",
        link_preview_options: {
          is_disabled: true
        }
      })
      .catch(async (err: unknown) => {
        if (isAxiosError(err)) {
          const error = err as AxiosError<TelegramAPIError>;
          if (
            error.response?.data.description !== undefined &&
            error.response.data.description ===
              "Forbidden: bot was blocked by the user"
          ) {
            await umami.log({ event: "/user-blocked-joel" });
            await new Blocked({
              chatId: user.chatId as ChatId
            }).save();
            return;
          }
        }
        console.log(err);
      });

    // prevent hitting the Telegram API rate limit
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

await (async () => {
  // Connect to DB
  await mongodbConnect();

  // Number of days to go back: 0 means we just fetch today's info
  const shiftDays = 0;

  // the currentDate is today
  const currentDate = new Date();
  const startDate = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate() - shiftDays
  );
  startDate.setHours(0, 0, 0, 0);
  // Fetch all records from the start date
  const JORFAllRecordsFromDate = await getJORFRecordsFromDate(startDate);
  // Sort records by date
  JORFAllRecordsFromDate.sort(
    (i, j) =>
      JORFtoDate(i.source_date).getTime() - JORFtoDate(j.source_date).getTime()
  );

  // Send notifications to users on followed people
  await notifyPeopleUpdates(JORFAllRecordsFromDate);

  // Send notifications to users on followed names
  await notifyNameMentionUpdates(JORFAllRecordsFromDate);

  // Send notifications to users on followed functions
  await notifyFunctionTagsUpdates(JORFAllRecordsFromDate);

  // Send notifications to users on followed organisations
  await notifyOrganisationsUpdates(JORFAllRecordsFromDate);

  await umami.log({ event: "/notification-process-completed" });

  process.exit(0);
})();
