import "dotenv/config";
import { mongodbConnect } from "../db.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import { IPeople, IUser, MessageApp, WikidataId } from "../types.ts";
import People from "../models/People.ts";
import User from "../models/User.ts";
import { Types } from "mongoose";
import umami from "../utils/umami.ts";
import { JORFtoDate } from "../utils/date.utils.ts";
import { formatSearchResult } from "../utils/formatSearchResult.ts";
import {
  callJORFSearchDay,
  cleanPeopleName,
  uniqueMinimalNameInfo
} from "../utils/JORFSearch.utils.ts";
import Organisation from "../models/Organisation.ts";
import { sendMessage } from "../entities/Session.ts";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { ErrorMessages } from "../entities/ErrorMessages.ts";
import { WHATSAPP_API_VERSION } from "../entities/WhatsAppSession.ts";
import { SignalCli } from "signal-sdk";
import groupBy from "lodash/groupBy";

const { ENABLED_APPS } = process.env;

if (ENABLED_APPS === undefined) throw new Error("ENABLED_APPS env var not set");

const enabledApps = JSON.parse(ENABLED_APPS) as MessageApp[];

let whatsAppAPI: WhatsAppAPI | undefined = undefined;
if (enabledApps.includes("WhatsApp")) {
  const { WHATSAPP_USER_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN } =
    process.env;
  if (
    WHATSAPP_USER_TOKEN === undefined ||
    WHATSAPP_APP_SECRET === undefined ||
    WHATSAPP_VERIFY_TOKEN === undefined
  )
    throw new Error(ErrorMessages.WHATSAPP_ENV_NOT_SET);

  whatsAppAPI = new WhatsAppAPI({
    token: WHATSAPP_USER_TOKEN,
    appSecret: WHATSAPP_APP_SECRET,
    webhookVerifyToken: WHATSAPP_VERIFY_TOKEN,
    v: WHATSAPP_API_VERSION
  });
}

let signalCli: SignalCli | undefined = undefined;
if (enabledApps.includes("Signal")) {
  const { SIGNAL_BAT_PATH, SIGNAL_PHONE_NUMBER } = process.env;
  if (SIGNAL_BAT_PATH === undefined || SIGNAL_PHONE_NUMBER === undefined)
    throw new Error(ErrorMessages.SIGNAL_ENV_NOT_SET);

  signalCli = new SignalCli(SIGNAL_BAT_PATH, SIGNAL_PHONE_NUMBER);
  await signalCli.connect();
}

async function getJORFRecordsFromDate(
  startDate: Date
): Promise<JORFSearchItem[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);

  // Build the list of days to fetch (inclusive)
  const dayCount = (today.getTime() - startDate.getTime()) / 86_400_000 + 1; // 1 day = 86 400 000 ms
  const days: Date[] = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    return d;
  });

  // Fetch them concurrently (limit to e.g. 8 at a time to stay polite)
  const limit = 8;
  const chunks: Date[][] = [];
  for (let i = 0; i < days.length; i += limit)
    chunks.push(days.slice(i, i + limit));

  const results: JORFSearchItem[][] = [];
  for (const sub of chunks) {
    results.push(...(await Promise.all(sub.map(callJORFSearchDay))));
  }

  return results
    .flat()
    .sort(
      (a, b) =>
        JORFtoDate(a.source_date).getTime() -
        JORFtoDate(b.source_date).getTime()
    );
}

export function buildTagMap(
  updatedRecords: JORFSearchItem[]
): Partial<Record<FunctionTags, JORFSearchItem[]>> {
  // constant-time membership test
  const tagSet = new Set<FunctionTags>(
    Object.values(FunctionTags) as FunctionTags[]
  );

  const tagMap: Partial<Record<FunctionTags, JORFSearchItem[]>> = {};

  for (const item of updatedRecords) {
    // iterate through the fields actually present on *this* record
    for (const key of Object.keys(item) as (keyof JORFSearchItem)[]) {
      if (!tagSet.has(key as FunctionTags)) continue; // not a tag we care about
      if (item[key] === undefined) continue; // defensive, should not happen

      (tagMap[key as FunctionTags] ??= []).push(item); // bucketise
    }
  }
  return tagMap;
}

export function buildOrganisationMapById(
  updatedRecords: JORFSearchItem[]
): Record<WikidataId, JORFSearchItem[]> {
  return updatedRecords.reduce<Record<WikidataId, JORFSearchItem[]>>(
    (orgMap, record) => {
      const seen = new Set<WikidataId>(); // dedupe ids inside this record

      for (const { wikidata_id } of record.organisations) {
        if (!wikidata_id || seen.has(wikidata_id)) continue; // skip undefined / duplicate

        seen.add(wikidata_id);
        (orgMap[wikidata_id] ??= []).push(record);
      }
      return orgMap;
    },
    {}
  );
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
          (f) => f.peopleId.toString() === followed.peopleId.toString()
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

// Update the timestamp of the last update date for a user-specific people follow
async function updateUserFollowedFunctions(
  user: IUser,
  updatedFunctionTags: FunctionTags[]
) {
  if (updatedFunctionTags.length == 0) {
    return;
  }

  const currentDate = new Date();

  user.followedFunctions = user.followedFunctions.reduce(
    (
      followedList: IUser["followedFunctions"],
      followed: { functionTag: FunctionTags; lastUpdate: Date }
    ) => {
      if (followedList.some((f) => f.functionTag === followed.functionTag))
        return followedList; // If the user follows twice the same tag, we drop the second record

      // if updated people: we update the timestamp
      if (
        updatedFunctionTags.some(
          (functionTag) => functionTag === followed.functionTag
        )
      ) {
        followedList.push({
          functionTag: followed.functionTag,
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
async function updateUserFollowedOrganisations(
  user: IUser,
  updatedOrgIds: WikidataId[]
) {
  if (updatedOrgIds.length == 0 || user.followedOrganisations.length == 0) {
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
  const updatedTagMap = buildTagMap(updatedRecords);
  const updatedTagList = Object.keys(updatedTagMap) as FunctionTags[];

  const usersFollowingTags: IUser[] = await User.find(
    {
      followedFunctions: {
        $exists: true,
        $not: { $size: 0 },
        $elemMatch: {
          functionTag: { $in: updatedTagList }
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
  );

  for (const user of usersFollowingTags) {
    // send tag notification to the user

    const newUserTagsUpdates: Partial<Record<FunctionTags, JORFSearchItem[]>> =
      {};

    for (const tagFollow of user.followedFunctions) {
      if ((updatedTagMap[tagFollow.functionTag]?.length ?? 0) == 0) continue;

      const dateFilteredUserTagUpdates: JORFSearchItem[] =
        updatedTagMap[tagFollow.functionTag]?.filter(
          (record: JORFSearchItem) =>
            JORFtoDate(record.source_date).getTime() >
            tagFollow.lastUpdate.getTime()
        ) ?? [];

      if (dateFilteredUserTagUpdates.length == 0) continue;

      newUserTagsUpdates[tagFollow.functionTag] = dateFilteredUserTagUpdates;
    }

    const messageSent = await sendTagUpdates(user, newUserTagsUpdates);

    if (messageSent) {
      await updateUserFollowedFunctions(
        user,
        Object.keys(newUserTagsUpdates) as FunctionTags[]
      );
    }
  }
}

interface miniOrg {
  nom: string;
  wikidataId: string;
}

// There is currently no way to check if a user has been notified of a tag update
// Resuming an update thus require to force-notify users for all tags updates over the period.
export async function notifyOrganisationsUpdates(
  allUpdatedRecords: JORFSearchItem[]
) {
  const updatedOrgsWikidataIdSet = new Set<WikidataId>(
    allUpdatedRecords
      .flatMap((r) => r.organisations) // all organisations of all records
      .map((o) => o.wikidata_id) // keep only the id
      .filter((id): id is WikidataId => !!id) // drop undefined / empty
  );
  if (updatedOrgsWikidataIdSet.size == 0) return;

  const updatedOrgsInDb: miniOrg[] = await Organisation.find({
    wikidataId: { $in: [...updatedOrgsWikidataIdSet] }
  });

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
  );

  if (usersFollowingOrganisations.length == 0) return;

  const orgNameById = new Map<WikidataId, string>(
    updatedOrgsInDb.map((o) => [o.wikidataId, o.nom])
  );

  const updatedRecordsWithOrgsInDb = allUpdatedRecords.filter((r) =>
    r.organisations.some(
      ({ wikidata_id }) => !!wikidata_id && orgNameById.has(wikidata_id)
    )
  );
  if (updatedRecordsWithOrgsInDb.length == 0) return;

  const updatedOrganisationMapById = buildOrganisationMapById(
    updatedRecordsWithOrgsInDb
  );

  for (const user of usersFollowingOrganisations) {
    if (user.followedOrganisations.length == 0) continue;

    // Records which are associated with followed Organisations, and which are new for the respective People follow
    const orgsFollowedByUserAndUpdatedMap = user.followedOrganisations.reduce(
      (orgTabList: Record<WikidataId, JORFSearchItem[]>, followData) => {
        const orgUpdates =
          updatedOrganisationMapById[followData.wikidataId] ?? [];
        if (orgUpdates.length == 0) return orgTabList;

        const newRecordsFollowedB = orgUpdates.filter(
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
    const messageSent = await sendOrganisationUpdate(
      user,
      orgsFollowedByUserAndUpdatedMap,
      orgNameById
    );
    if (messageSent) {
      // update each lastUpdate fields of the user followedPeople
      await updateUserFollowedOrganisations(
        user,
        Object.keys(orgsFollowedByUserAndUpdatedMap)
      );
    }
  }
}

export async function notifyPeopleUpdates(updatedRecords: JORFSearchItem[]) {
  const minimalInfoUpdated = uniqueMinimalNameInfo(updatedRecords);

  const byPrenom = groupBy(minimalInfoUpdated, "prenom"); // { "Doe": [{…}, …], "Dupont": … }

  const filters = Object.entries(byPrenom).map(([prenom, arr]) => ({
    prenom, // equality ⇒ index-friendly
    nom: { $in: arr.map((a) => a.nom) } // still index-friendly
  }));

  const updatedPeopleList: IPeople[] = await People.find({ $or: filters })
    .collation({ locale: "fr", strength: 2 }) // case-insensitive, no regex
    .lean();

  // Fetch all users following at least one of the updated People
  const updatedUsers: IUser[] = await User.find(
    {
      followedPeople: {
        $elemMatch: {
          peopleId: {
            $in: updatedPeopleList.map((i) => i._id)
          }
        }
      },
      status: "active",
      messageApp: { $in: enabledApps }
    },
    {
      _id: 1,
      messageApp: 1,
      chatId: 1,
      followedPeople: { peopleId: 1, lastUpdate: 1 },
      schemaVersion: 1
    }
  );

  for (const user of updatedUsers) {
    // Ids of all people followed by the user
    const peopleIdStrsFollowedByUser = user.followedPeople.map((j) =>
      j.peopleId.toString()
    );
    const updatedPeopleFollowedByUser = updatedPeopleList.filter((i) =>
      peopleIdStrsFollowedByUser.includes(i._id.toString())
    );
    const updatedPeopleInfoFollowedByUser = uniqueMinimalNameInfo(
      updatedPeopleFollowedByUser
    );

    // Records which are associated with followed People, and which are new for the respective People follow
    const newRecordsFollowedByUser = updatedRecords.reduce(
      (recordList: JORFSearchItem[], record) => {
        // remove records not associated with followed people
        // this is the first main filter
        if (
          !updatedPeopleInfoFollowedByUser.some(
            (p) =>
              p.nom.toUpperCase() === record.nom.toUpperCase() &&
              p.prenom.toUpperCase() === record.prenom.toUpperCase()
          )
        )
          return recordList;

        const updatedPeople: IPeople | undefined =
          updatedPeopleFollowedByUser.find(
            (i) => i.nom === record.nom && i.prenom === record.prenom
          );
        if (updatedPeople == null) return recordList; // this should not happen

        // Find the follow data associated with these people record
        const followData = user.followedPeople.find(
          (i) => i.peopleId.toString() === updatedPeople._id.toString()
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
    const messageSent = await sendPeopleUpdate(user, newRecordsFollowedByUser);

    if (messageSent) {
      // Ids of updated peoples:
      const updatedRecordsPeopleId: Types.ObjectId[] =
        updatedPeopleFollowedByUser
          .filter((p) =>
            newRecordsFollowedByUser.some(
              (r) => r.nom === p.nom && r.prenom === p.prenom
            )
          )
          .map((p) => p._id);

      // update each lastUpdate fields of the user followedPeople
      await updateUserFollowedPeople(user, updatedRecordsPeopleId);
    }
  }
}

export async function notifyNameMentionUpdates(
  updatedRecords: JORFSearchItem[]
) {
  const userFollowingNames: IUser[] = await User.find(
    {
      "followedNames.0": { $exists: true },
      status: "active",
      messageApp: { $in: enabledApps }
    },
    {
      _id: 1,
      messageApp: 1,
      chatId: 1,
      followedNames: 1,
      followedPeople: { peopleId: 1, lastUpdate: 1 },
      schemaVersion: 1
    }
  );

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
      return followedPerson.peopleId.toString() === person._id.toString();
    });
  };

  for (const user of userFollowingNames) {
    const nameUpdates: {
      followedName: string;
      people: IPeople;
      nameJORFRecords: JORFSearchItem[];
    }[] = [];

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

      const people = await People.findOrCreate({
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
          peopleId: people._id,
          lastUpdate: new Date(Date.now())
        });
      }
    }

    await sendNameMentionUpdates(
      user,
      nameUpdates.map((i) => ({
        people: i.people,
        updateItems: i.nameJORFRecords
      }))
    );

    await user.save();
  }
}

async function sendNameMentionUpdates(
  user: IUser,
  nameUpdates: { people: IPeople; updateItems: JORFSearchItem[] }[]
): Promise<boolean> {
  if (nameUpdates.length == 0) return true; // no need to send notification if no name mention updates

  // Reverse array change order of records
  //updatedRecords.reverse();

  const pluralHandler = nameUpdates.length > 1 ? "s" : "";

  let notification_text = `📢 Nouvelle${pluralHandler} publication${pluralHandler} parmi les noms que vous suivez manuellement:\n\n`;

  for (let i = 0; i < nameUpdates.length; i++) {
    notification_text += formatSearchResult(
      nameUpdates[i].updateItems,
      user.messageApp === "Telegram",
      {
        isConfirmation: false,
        isListing: true,
        displayName: "first"
      }
    );
    notification_text += `Vous suivez maintenant *${nameUpdates[i].people.prenom} ${nameUpdates[i].people.nom}* ✅`;
    if (i < nameUpdates.length - 1) notification_text += "\n\n";
  }

  const messageSent = await sendMessage(user, notification_text, {
    signalCli: signalCli,
    whatsAppAPI: whatsAppAPI
  });
  if (!messageSent) return false;

  await umami.log({ event: "/notification-update-name" });
  return true;
}

async function sendPeopleUpdate(user: IUser, updatedRecords: JORFSearchItem[]) {
  const nbPersonUpdated = uniqueMinimalNameInfo(updatedRecords).length;

  if (nbPersonUpdated == 0) return true; // no need to send notification if no name mention updates

  // Reverse array change order of records
  //updatedRecords.reverse();

  const pluralHandler = updatedRecords.length > 1 ? "s" : "";

  let notification_text = `📢 Nouvelle${pluralHandler} publication${pluralHandler} parmi les personnes que vous suivez :\n\n`;
  notification_text += formatSearchResult(
    updatedRecords,
    user.messageApp === "Telegram",
    {
      isConfirmation: false,
      isListing: true,
      displayName: "all"
    }
  );

  const messageSent = await sendMessage(user, notification_text, {
    signalCli: signalCli,
    whatsAppAPI: whatsAppAPI
  });
  if (!messageSent) return false;

  await umami.log({ event: "/notification-update-people" });
  return true;
}

async function sendOrganisationUpdate(
  user: IUser,
  orgMap: Record<WikidataId, JORFSearchItem[]>,
  orgNameById: Map<WikidataId, string>
): Promise<boolean> {
  const orgsUpdated = Object.keys(orgMap);
  if (orgsUpdated.length == 0) return true;

  let notification_text =
    "📢 Nouvelles publications parmi les organisations que suivez :\n\n";

  for (const orgId of orgsUpdated) {
    const orgName = orgNameById.get(orgId);
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

    notification_text += formatSearchResult(
      orgRecords,
      user.messageApp === "Telegram",
      {
        isConfirmation: false,
        isListing: true,
        displayName: "all"
      }
    );

    if (orgsUpdated.indexOf(orgId) + 1 !== orgsUpdated.length)
      notification_text += "====================\n\n";

    notification_text += "\n";
  }

  const messageSent = await sendMessage(user, notification_text, {
    signalCli: signalCli,
    whatsAppAPI: whatsAppAPI
  });
  if (!messageSent) return false;

  await umami.log({ event: "/notification-update-organisation" });
  return true;
}

async function sendTagUpdates(
  user: IUser,
  tagMap: Partial<Record<FunctionTags, JORFSearchItem[]>>
): Promise<boolean> {
  // only keep the tags followed by the user
  const tagList = Object.keys(tagMap) as FunctionTags[];

  if (tagList.length == 0) return true;

  let notification_text =
    "📢 Nouvelles publications parmi les fonctions que suivez :\n\n";

  // We preload the tag keys and values to reduce search time
  const tagValues = Object.values(FunctionTags);
  const tagKeys = Object.keys(FunctionTags);

  for (const tagValue of tagList) {
    const tagKey = tagKeys[tagValues.indexOf(tagValue)];

    const tagRecords: JORFSearchItem[] = tagMap[tagValue] ?? [];
    if (tagRecords.length == 0) continue;
    // Reverse array change order of records
    // updatedRecords.reverse();

    const pluralHandler = tagRecords.length > 1 ? "s" : "";
    notification_text += `Nouvelle${pluralHandler} publication${pluralHandler} pour la fonction *${tagKey}*\n\n`;

    notification_text += formatSearchResult(
      tagRecords,
      user.messageApp === "Telegram",
      {
        isConfirmation: false,
        isListing: true,
        displayName: "all"
      }
    );

    if (tagList.indexOf(tagValue) + 1 !== tagList.length)
      notification_text += "====================\n\n";

    notification_text += "\n";
  }

  const messageSent = await sendMessage(user, notification_text, {
    signalCli: signalCli,
    whatsAppAPI: whatsAppAPI
  });
  if (!messageSent) return false;

  await umami.log({ event: "/notification-update-function" });
  return true;
}

await (async () => {
  // Connect to DB
  await mongodbConnect();

  // Number of days to go back: 0 means we just fetch today's info
  const shiftDays = 3;

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
