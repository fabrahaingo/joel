import "dotenv/config";
import { mongodbConnect } from "../db.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import {
  IOrganisation,
  IPeople,
  IUser,
  MessageApp,
  WikidataId
} from "../types.ts";
import People from "../models/People.ts";
import User from "../models/User.ts";
import { Types } from "mongoose";
import umami from "../utils/umami.ts";
import { JORFtoDate } from "../utils/date.utils.ts";
import { formatSearchResult } from "../utils/formatSearchResult.ts";
import {
  callJORFSearchDay,
  cleanPeopleName
} from "../utils/JORFSearch.utils.ts";
import Organisation from "../models/Organisation.ts";
import { sendMessage } from "../entities/Session.ts";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { ErrorMessages } from "../entities/ErrorMessages.ts";
import { WHATSAPP_API_VERSION } from "../entities/WhatsAppSession.ts";
import { SignalCli } from "signal-sdk";

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

// There is currently no way to check if a user has been notified of a tag update
// Resuming an update thus require to force-notify users for all tags updates over the period.
export async function notifyFunctionTagsUpdates(
  updatedRecords: JORFSearchItem[]
) {
  if (updatedRecords.length == 0) return;

  const functionTagValues: string[] = Object.values(FunctionTags);

  // Initialize an empty tag map to store the categorized records
  const updatedTagMap = new Map<FunctionTags, JORFSearchItem[]>();

  // Build the tag map from the updated records
  updatedRecords.forEach((item) => {
    // Iterate through each key in the current record
    (Object.keys(item) as (keyof JORFSearchItem)[]).forEach((key) => {
      // Check if the key is a valid function tag
      if (functionTagValues.includes(key)) {
        const keyFctTag = key as FunctionTags;

        // Update the tag map
        const currentItems = updatedTagMap.get(keyFctTag) ?? [];
        updatedTagMap.set(keyFctTag, [...currentItems, item]);
      }
    });
  });

  // Create a set of unique tag keys
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
  if (usersFollowingTags.length == 0) return;

  const now = new Date();

  const userUpdateTasks: {
    userId: Types.ObjectId;
    messageApp: MessageApp;
    chatId: IUser["chatId"];
    tagUpdateRecordsMap: Map<FunctionTags, JORFSearchItem[]>;
    recordCount: number;
  }[] = [];

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

    // Calculate the total number of JORFSearchItem in the map
    let totalUserRecordsCount = 0;
    newUserTagsUpdates.forEach((items) => {
      totalUserRecordsCount += items.length;
    });

    userUpdateTasks.push({
      userId: user._id,
      messageApp: user.messageApp,
      chatId: user.chatId,
      tagUpdateRecordsMap: newUserTagsUpdates,
      recordCount: totalUserRecordsCount
    });
  }

  for (const task of userUpdateTasks) {
    const messageSent = await sendTagUpdates(
      task.messageApp,
      task.chatId,
      task.tagUpdateRecordsMap
    );

    if (messageSent) {
      await User.updateOne(
        {
          _id: task.userId,
          "followedFunctions.functionTag": {
            $in: [...task.tagUpdateRecordsMap.keys()]
          } // to avoid duplicate key error
        },
        { $set: { "followedFunctions.$[elem].lastUpdate": now } },
        {
          arrayFilters: [
            {
              "elem.functionTag": { $in: [...task.tagUpdateRecordsMap.keys()] }
            }
          ]
        }
      );
    }
  }
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

  const updatedOrgsInDb: IOrganisation[] = await Organisation.find({
    wikidataId: { $in: [...updatedOrgsWikidataIdSet] }
  }).lean();
  if (updatedOrgsInDb.length == 0) return;

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

  // Initialize an empty org map to store the categorized records
  const updatedOrganisationsbyIdMap = new Map<WikidataId, JORFSearchItem[]>();

  // Build the tag map from the updated records
  updatedRecordsWithOrgsInDb.forEach((item) => {
    // Iterate through each key in the current record
    item.organisations.forEach(({ wikidata_id }) => {
      if (wikidata_id != undefined) {
        // this should not happen
        updatedOrganisationsbyIdMap.set(
          wikidata_id,
          (updatedOrganisationsbyIdMap.get(wikidata_id) ?? []).concat([item])
        );
      }
    });
  });

  const userUpdateTasks: {
    userId: Types.ObjectId;
    messageApp: MessageApp;
    chatId: IUser["chatId"];
    organisationsUpdateRecordsMap: Map<WikidataId, JORFSearchItem[]>;
    recordCount: number;
  }[] = [];

  const now = new Date();

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

    // Calculate the total number of JORFSearchItem in the map
    let totalUserRecordsCount = 0;
    newUserOrganisationsUpdates.forEach((items) => {
      totalUserRecordsCount += items.length;
    });

    userUpdateTasks.push({
      userId: user._id,
      messageApp: user.messageApp,
      chatId: user.chatId,
      organisationsUpdateRecordsMap: newUserOrganisationsUpdates,
      recordCount: totalUserRecordsCount
    });
  }

  for (const task of userUpdateTasks) {
    // send follow notification to the user
    const messageSent = await sendOrganisationUpdate(
      task.messageApp,
      task.chatId,
      task.organisationsUpdateRecordsMap,
      orgNameById
    );

    if (messageSent) {
      await User.updateOne(
        {
          _id: task.userId,
          "followedOrganisations.wikidataId": {
            $in: [...task.organisationsUpdateRecordsMap.keys()]
          } // to avoid duplicate key error
        },
        { $set: { "followedOrganisations.$[elem].lastUpdate": now } },
        {
          arrayFilters: [
            {
              "elem.wikidataId": {
                $in: [...task.organisationsUpdateRecordsMap.keys()]
              }
            }
          ]
        }
      );
    }
  }
}

export async function notifyPeopleUpdates(updatedRecords: JORFSearchItem[]) {
  if (updatedRecords.length == 0) return;

  const peopleJSONSet = new Set<string>();
  updatedRecords.forEach((person) => {
    peopleJSONSet.add(
      JSON.stringify({ nom: person.nom, prenom: person.prenom })
    );
  });

  // Significantly optimize mongoose request by grouping filters by prenom
  const byPrenom = [...peopleJSONSet]
    .map((i) => JSON.parse(i) as { nom: string; prenom: string })
    .reduce(
      (acc: Record<string, { nom: string; prenom: string }[]>, person) => {
        acc[person.prenom] = (acc[person.prenom] ??= []).concat([person]); // Push the object to the array corresponding to its prenom
        return acc;
      },
      {}
    );

  // Create an array of filter objects
  const filtersbyPrenom = Object.entries(byPrenom).map(([prenom, arr]) => ({
    prenom, // This field is used for equality checks, which is index-friendly
    nom: { $in: arr.map((a) => a.nom) } // This field is used to match any of the "nom" values, which is also index-friendly
  }));

  const updatedPeopleList: IPeople[] = await People.find({
    $or: filtersbyPrenom
  })
    .collation({ locale: "fr", strength: 2 }) // case-insensitive, no regex
    .lean();
  if (updatedPeopleList.length == 0) return;

  // Fetch all users following at least one of the updated People
  const usersFollowingPeople: IUser[] = await User.find(
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
  ).lean();
  if (usersFollowingPeople.length == 0) return;

  const cleanPeopleInfo = updatedPeopleList.map((p) => ({
    prenom: cleanPeopleName(p.prenom),
    nom: cleanPeopleName(p.nom)
  }));

  // Initialize an empty org map to store the categorized records
  const updatedPeoplebyIdMap = new Map<string, JORFSearchItem[]>();

  // Build the tag map from the updated records
  updatedRecords.forEach((item) => {
    const peopleIdx = cleanPeopleInfo.findIndex(
      (p) =>
        p.nom === cleanPeopleName(item.nom) &&
        p.prenom === cleanPeopleName(item.prenom)
    );
    if (peopleIdx != -1) {
      // this should always happen
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

  const userUpdateTasks: {
    userId: Types.ObjectId;
    messageApp: MessageApp;
    chatId: IUser["chatId"];
    peopleUpdateRecordsMap: Map<string, JORFSearchItem[]>;
    recordCount: number;
  }[] = [];

  const now = new Date();

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

    // Calculate the total number of JORFSearchItem in the map
    let totalUserRecordsCount = 0;
    newUserPeopleUpdates.forEach((items) => {
      totalUserRecordsCount += items.length;
    });

    userUpdateTasks.push({
      userId: user._id,
      messageApp: user.messageApp,
      chatId: user.chatId,
      peopleUpdateRecordsMap: newUserPeopleUpdates,
      recordCount: totalUserRecordsCount
    });
  }

  for (const task of userUpdateTasks) {
    // send follow notification to the user
    const messageSent = await sendPeopleUpdate(
      task.messageApp,
      task.chatId,
      task.peopleUpdateRecordsMap
    );

    if (messageSent) {
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

      await User.updateOne(
        {
          _id: task.userId,
          "followedPeople.peopleId": {
            $in: updatedRecordsPeopleId
          } // to avoid duplicate key error
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
  ).lean();
  if (userFollowingNames.length == 0) return;

  const nameMaps = updatedRecords.reduce(
    (acc, item: JORFSearchItem) => {
      const nomPrenom = cleanPeopleName(`${item.nom} ${item.prenom}`);
      const prenomNom = cleanPeopleName(`${item.prenom} ${item.nom}`);

      const nomPrenomList = acc.nomPrenomMap.get(nomPrenom) ?? []; // existing array or a new one
      const prenomNomList = acc.prenomNomMap.get(prenomNom) ?? []; // existing array or a new one

      nomPrenomList.push(item);
      prenomNomList.push(item);

      acc.nomPrenomMap.set(nomPrenom, nomPrenomList); // update the map
      acc.prenomNomMap.set(prenomNom, prenomNomList); // update the map

      return acc;
    },
    {
      nomPrenomMap: new Map<string, JORFSearchItem[]>(),
      prenomNomMap: new Map<string, JORFSearchItem[]>()
    }
  );

  const now = new Date();

  for (const user of userFollowingNames) {
    const nameUpdates: {
      followedName: string;
      people: IPeople;
      nameJORFRecords: JORFSearchItem[];
    }[] = [];

    for (const followedName of user.followedNames) {
      const cleanFollowedName = cleanPeopleName(followedName);
      const mentions =
        nameMaps.nomPrenomMap.get(cleanFollowedName) ??
        nameMaps.prenomNomMap.get(cleanFollowedName);

      if (mentions === undefined || mentions.length == 0) continue;

      const people = await People.findOrCreate({
        nom: mentions[0].nom,
        prenom: mentions[0].prenom
      });

      nameUpdates.push({
        followedName,
        people,
        nameJORFRecords: mentions
      });
    }

    await sendNameMentionUpdates(
      user.messageApp,
      user.chatId,
      nameUpdates.map((i) => ({
        people: i.people,
        updateItems: i.nameJORFRecords
      }))
    );

    const newFollows = nameUpdates
      .map((i) => i.people._id)
      .filter((id) => !user.followedPeople.some((i) => i.peopleId.equals(id)));

    await User.updateOne(
      { _id: user._id },
      {
        $pull: {
          followedNames: {
            $in: nameUpdates.map((update) => update.followedName)
          }
        },
        $push: {
          followedPeople: {
            // add the newFollows to the user followedPeople
            $each: newFollows.map((f) => ({
              peopleId: f._id,
              lastUpdate: now
            }))
          }
        }
      }
    );
  }
}

async function sendNameMentionUpdates(
  messageApp: MessageApp,
  chatId: IUser["chatId"],
  nameUpdates: { people: IPeople; updateItems: JORFSearchItem[] }[]
): Promise<boolean> {
  if (nameUpdates.length == 0) return true; // no need to send notification if no name mention updates

  // Reverse array change order of records
  //updatedRecords.reverse();

  const pluralHandler = nameUpdates.length > 1 ? "s" : "";

  const markdownEnabled = messageApp === "Telegram";

  let notification_text = `📢 Nouvelle${pluralHandler} publication${pluralHandler} parmi les noms que vous suivez manuellement:\n\n`;

  for (let i = 0; i < nameUpdates.length; i++) {
    notification_text += formatSearchResult(
      nameUpdates[i].updateItems,
      markdownEnabled,
      {
        isConfirmation: false,
        isListing: true,
        displayName: "first"
      }
    );
    notification_text += `Vous suivez maintenant *${nameUpdates[i].people.prenom} ${nameUpdates[i].people.nom}* ✅`;
    if (i < nameUpdates.length - 1) notification_text += "\n\n";
  }

  const messageSent = await sendMessage(messageApp, chatId, notification_text, {
    signalCli: signalCli,
    whatsAppAPI: whatsAppAPI
  });
  if (!messageSent) return false;

  await umami.log({ event: "/notification-update-name" });
  return true;
}

async function sendPeopleUpdate(
  messageApp: MessageApp,
  chatId: IUser["chatId"],
  updatedRecordMap: Map<string, JORFSearchItem[]>
) {
  if (updatedRecordMap.size == 0) return true; // no need to send notification if no name mention updates

  // Reverse array change order of records
  //updatedRecords.reverse();

  const pluralHandler = updatedRecordMap.size > 1 ? "s" : "";

  const markdownEnabled = messageApp === "Telegram";

  let notification_text = `📢 Nouvelle${pluralHandler} publication${pluralHandler} parmi les personnes que vous suivez :\n\n`;

  const keys = Array.from(updatedRecordMap.keys());
  const lastKey = keys[keys.length - 1];

  for (const peopleId of updatedRecordMap.keys()) {
    const peopleRecords = updatedRecordMap.get(peopleId);
    if (peopleRecords === undefined || peopleRecords.length == 0) {
      console.log("People notification update sent with no records");
      continue;
    }
    // Reverse array change order of records
    // peopleRecords.reverse();

    const pluralHandler = peopleRecords.length > 1 ? "s" : "";
    notification_text += `Nouvelle${pluralHandler} publication${pluralHandler} pour *${peopleRecords[0].prenom} ${peopleRecords[0].nom}*\n\n`;

    notification_text += formatSearchResult(peopleRecords, markdownEnabled, {
      isConfirmation: false,
      isListing: true,
      displayName: "first"
    });

    if (peopleId !== lastKey) notification_text += "====================\n\n";
  }

  const messageSent = await sendMessage(messageApp, chatId, notification_text, {
    signalCli: signalCli,
    whatsAppAPI: whatsAppAPI
  });
  if (!messageSent) return false;

  await umami.log({ event: "/notification-update-people" });
  return true;
}

async function sendOrganisationUpdate(
  messageApp: MessageApp,
  chatId: IUser["chatId"],
  organisationsUpdateRecordsMap: Map<WikidataId, JORFSearchItem[]>,
  orgNameById: Map<WikidataId, string>
): Promise<boolean> {
  if (organisationsUpdateRecordsMap.size == 0) return true;

  let notification_text =
    "📢 Nouvelles publications parmi les organisations que suivez :\n\n";

  const markdownEnabled = messageApp === "Telegram";

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
    if (orgRecords === undefined || orgRecords.length == 0) {
      console.log("Organisation notification update sent with no records");
      continue;
    }

    // Reverse array change order of records
    // orgRecords.reverse();

    const pluralHandler = orgRecords.length > 1 ? "s" : "";
    notification_text += `Nouvelle${pluralHandler} publication${pluralHandler} pour *${orgName}*\n\n`;

    notification_text += formatSearchResult(orgRecords, markdownEnabled, {
      isConfirmation: false,
      isListing: true,
      displayName: "all"
    });

    if (orgId !== lastKey) notification_text += "====================\n\n";
  }

  const messageSent = await sendMessage(messageApp, chatId, notification_text, {
    signalCli: signalCli,
    whatsAppAPI: whatsAppAPI
  });
  if (!messageSent) return false;

  await umami.log({ event: "/notification-update-organisation" });
  return true;
}

// We preload the tag keys and values to reduce search time
const tagValues = Object.values(FunctionTags);
const tagKeys = Object.keys(FunctionTags);

async function sendTagUpdates(
  messageApp: MessageApp,
  chatId: IUser["chatId"],
  tagMap: Map<FunctionTags, JORFSearchItem[]>
): Promise<boolean> {
  // only keep the tags followed by the user
  const tagList = [...tagMap.keys()];

  if (tagList.length == 0) return true;

  let notification_text =
    "📢 Nouvelles publications parmi les fonctions que suivez :\n\n";

  const markdownEnabled = messageApp === "Telegram";

  const keys = Array.from(tagMap.keys());
  const lastKey = keys[keys.length - 1];

  for (const tag of tagMap.keys()) {
    const tagRecords = tagMap.get(tag);
    if (tagRecords === undefined || tagRecords.length == 0) {
      console.log("Tag notification update sent with no records");
      continue;
    }
    const tagKey = tagKeys[tagValues.indexOf(tag)];

    // Reverse array change order of records
    // updatedRecords.reverse();

    const pluralHandler = tagRecords.length > 1 ? "s" : "";
    notification_text += `Nouvelle${pluralHandler} publication${pluralHandler} pour la fonction *${tagKey}*\n\n`;

    notification_text += formatSearchResult(tagRecords, markdownEnabled, {
      isConfirmation: false,
      isListing: true,
      displayName: "all"
    });

    if (tag !== lastKey) notification_text += "====================\n\n";
  }

  const messageSent = await sendMessage(messageApp, chatId, notification_text, {
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

  if (JORFAllRecordsFromDate.length > 0) {
    // Send notifications to users on followed people
    await notifyPeopleUpdates(JORFAllRecordsFromDate);

    // Send notifications to users on followed names
    await notifyNameMentionUpdates(JORFAllRecordsFromDate);

    // Send notifications to users on followed functions
    await notifyFunctionTagsUpdates(JORFAllRecordsFromDate);

    // Send notifications to users on followed organisations
    await notifyOrganisationsUpdates(JORFAllRecordsFromDate);
  }

  await umami.log({ event: "/notification-process-completed" });

  process.exit(0);
})();
