import {
  JORFSearchItem,
  JORFSearchResponse,
} from "../entities/JORFSearchResponse";
import { FunctionTags } from "../entities/FunctionTags";
import { IPeople, IUser } from "../types";
import People from "../models/People";
import umami from "./umami";
import { dateTOJORFFormat, JORFtoDate } from "./date.utils";
import axios, { AxiosError } from "axios";
import Blocked from "../models/Blocked";
import User from "../models/User";
import { formatSearchResult } from "./formatSearchResult";
import { splitText } from "./sendLongText";
import { ChatId } from "node-telegram-bot-api";
import { Types } from "mongoose";

function isItemTagged(item: JORFSearchItem, tag: FunctionTags) {
  return Object.prototype.hasOwnProperty.call(item, tag);
}

function extractTaggedItems(JORF_items: JORFSearchItem[], tag: FunctionTags) {
  return JORF_items.filter((item) => isItemTagged(item, tag));
}

export async function updatePeopleFromTags(updatedRecords: JORFSearchItem[]) {
  // Order records by date: latest on top

  // extracts the relevant tags from the daily updates
  // format: {tag: [contacts], tag2: [contacts]}
  const itemTagMap: [[FunctionTags], JORFSearchItem[]][] = [];

  let peopleList: JORFSearchItem[] = [];

  for (const tag of Object.values(FunctionTags)) {
    // Add records corresponding to each tag extraction
    const tagExtraction = extractTaggedItems(updatedRecords, tag);
    if (tagExtraction.length > 0) {
      itemTagMap[tag] = tagExtraction;
      peopleList = peopleList.concat(tagExtraction);
    }
  }

  // Remove duplicates in the list to limit db queries
  const reducedPeopleList = peopleList.filter(
    (people, index, self) =>
      index ==
      self.findIndex((t) => t.nom == people.nom && t.prenom == people.prenom),
  );

  for (const record of reducedPeopleList) {
    const people: IPeople | null = await People.findOne({
      nom: record.nom,
      prenom: record.prenom,
    });

    // If People in dB, update the lastKnownPosition
    if (people !== null) await updatePeople([{ people, records: [record] }]);
    // if the person doesn't exist, create a new one
    else {
      const newPerson: IPeople = new People({
        nom: record.nom,
        prenom: record.prenom,
        lastKnownPosition: record,
      });
      await newPerson.save();
      await umami.log({ event: "/person-added" });
    }
  }
  return itemTagMap;
}

export async function getJORFRecordsFromDate(
  startDate: Date,
): Promise<JORFSearchItem[]> {
  const todayDate = new Date();

  // In place operations
  startDate.setHours(0, 0, 0, 0);
  todayDate.setHours(0, 0, 0, 0);

  const targetDateStr = dateTOJORFFormat(startDate);

  // From today, until the start
  // Order is important to keep record sorted, and remove later ones as duplicates
  let updatedPeople: JORFSearchItem[] = [];

  const currentDate = new Date(todayDate);
  let running = true;
  while (running) {
    const JORFPeople: JORFSearchItem[] = await getDailyUpdate(currentDate);

    updatedPeople = updatedPeople.concat(JORFPeople);
    running = dateTOJORFFormat(currentDate) !== targetDateStr;
    currentDate.setDate(currentDate.getDate() - 1);
  }
  return updatedPeople;
}

async function getRelevantPeopleFromDb(
  recordsList: JORFSearchItem[],
): Promise<{ people: IPeople; records: JORFSearchItem[] }[]> {
  if (recordsList.length === 0) return [];

  const peopleList: IPeople[] = await People.find({
    $or: recordsList.map((record) => ({
      nom: record.nom,
      prenom: record.prenom,
    })),
  });

  const relevantPeopleMap: { people: IPeople; records: JORFSearchItem[] }[] =
    [];

  for (const people of peopleList) {
    relevantPeopleMap.push({
      people,
      records: recordsList.filter(
        (t) => t.nom == people.nom && t.prenom == people.prenom,
      ),
    });
  }
  return relevantPeopleMap;
}

async function updatePeople(
  peopleUpdates: { people: IPeople; records: JORFSearchItem[] }[],
) {
  for (const peopleUpdate of peopleUpdates) {
    const people = peopleUpdate.people;

    for (const record of peopleUpdate.records) {
      const source_people_id = parseInt(
        people.lastKnownPosition.source_id.split("JORFTEXT").slice(-1)[0],
      );
      const source_record_id = parseInt(
        record.source_id.split("JORFTEXT").slice(-1)[0],
      );

      // Record is older (day) than last registered
      if (source_people_id >= source_record_id) {
        continue;
      }

      people.lastKnownPosition = record;
      await umami.log({ event: "/person-updated" });
      await people.save();
    }
  }
}

export async function getDailyUpdate(date: Date): Promise<JORFSearchItem[]> {
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);

  if (date.getTime() > todayDate.getTime()) {
    throw Error("Unable to fetch JORF updates in future dates");
  }
  const dailyUpdates = await axios
    .get<JORFSearchResponse>(
      `https://jorfsearch.steinertriples.ch/${dateTOJORFFormat(date)}?format=JSON`,
    )
    .then((res) => res.data)
    .catch((err: unknown) => {
      console.log(err);
      return [];
    });

  if (dailyUpdates === null || typeof dailyUpdates === "string") {
    return [];
  }

  return dailyUpdates;
  // Do not filter out duplicates: only the first item of each people will be keep for record keeping;
}

// Update people in DB from starting date and return JORFItems of updated
export async function updatePeopleInDB(updatedRecords: JORFSearchItem[]) {
  const relevantPeople = await getRelevantPeopleFromDb(updatedRecords);
  await updatePeople(relevantPeople);

  return relevantPeople;
}

async function filterOutBlockedUsers(users: IUser[]): Promise<IUser[]> {
  const blockedUsers: IUser[] = await Blocked.find({}, { _id: 1 });
  for (const blockedUser of blockedUsers) {
    users = users.filter((user) => user._id === blockedUser._id);
  }
  return users;
}

async function updateUserFollows(user: IUser, peoples: IPeople[]) {
  const peoplesIdArray = peoples.map((people) => people._id);

  const currentDate = new Date();

  for (const followedPerson of user.followedPeople) {
    if (peoplesIdArray.includes(followedPerson.peopleId)) {
      followedPerson.lastUpdate = currentDate;
    }
  }
  // remove duplicated in followedPeople array that have same peopleId (can happen if user has followed a person twice)
  user.followedPeople = user.followedPeople.filter(
    (followedPerson: { peopleId: Types.ObjectId }, index: number, self) =>
      index ===
      self.findIndex(
        (t: { peopleId: Types.ObjectId }) =>
          t.peopleId === followedPerson.peopleId,
      ),
  );
  // save user
  await user.save();
}

// There is currently no way to check if a user has been notified of a tag update
// Resuming an update thus require to force-notify users for all tags update over the period.
// Before: use updateTagsFromDate to update db
export async function forceNotifyTagUpdates(
  tagMap: [[FunctionTags], JORFSearchItem[]][],
  BOT_TOKEN: string,
) {
  const tagListStr = Object.keys(tagMap);

  const updatedUsers: IUser[] = await User.find({
    followedFunctions: {
      $elemMatch: {
        $in: tagListStr,
      },
    },
  }).then(async (res: IUser[]) => {
    return await filterOutBlockedUsers(res);
  });

  for (const user of updatedUsers) {
    const relevantTagsUpdates: [[FunctionTags], JORFSearchItem[]][] = [];
    for (const tag of user.followedFunctions) {
      const tagStack: JORFSearchItem[] = tagMap[tag];
      if (tagStack !== undefined && tagStack.length > 0)
        relevantTagsUpdates[tag] = tagStack;
    }
    // send notification to user
    await sendForcedTagUpdates(user, relevantTagsUpdates, BOT_TOKEN);
  }
}

export async function notifyPeopleUpdates(
  updatedPeopleRecords: { people: IPeople; records: JORFSearchItem[] }[],
  BOT_TOKEN: string,
  FORCE_NOTIFY?: boolean,
) {
  // Search all users at once to reduce strain on DB
  const peopleIdStringArray = updatedPeopleRecords.map((i) =>
    i.people._id.toString(),
  );

  const updatedUsers: IUser[] = await User.find({
    followedPeople: {
      $elemMatch: {
        peopleId: {
          $in: peopleIdStringArray,
        },
      },
    },
  }).then(async (res: IUser[]) => {
    return await filterOutBlockedUsers(res);
  });

  for (const user of updatedUsers) {
    const userFollowedIdsStr = user.followedPeople.map((item) =>
      item.peopleId.toString(),
    );

    // Filter people followed by the user
    const userSpecificUpdates = updatedPeopleRecords.filter(
      (item) =>
        userFollowedIdsStr.findIndex((t) => item.people._id.toString() === t) >=
        0,
    );
    // send notification to user
    await sendPeopleUpdate(user, userSpecificUpdates, BOT_TOKEN, FORCE_NOTIFY);

    await updateUserFollows(
      user,
      userSpecificUpdates.map((t) => t.people),
    );
  }
}

async function sendPeopleUpdate(
  user: IUser,
  peopleUpdated: { people: IPeople; records: JORFSearchItem[] }[],
  BOT_TOKEN: string,
  FORCE_NOTIFY?: boolean,
) {
  // Drop records of people that are up to date
  let filteredUpdates: { people: IPeople; records: JORFSearchItem[] }[] = [];

  if (FORCE_NOTIFY) {
    filteredUpdates = peopleUpdated;
  } else {
    for (const peopleUpdate of peopleUpdated) {
      // Filter records that are up to date
      const idPeople = user.followedPeople.findIndex(
        (p) => p.peopleId.toString() === peopleUpdate.people._id.toString(),
      );
      if (idPeople < 0) {
        continue;
      }
      const lastUpdateDate = user.followedPeople[idPeople].lastUpdate;
      const relevantRecords = peopleUpdate.records.filter(
        (r) => JORFtoDate(r.source_date).getTime() < lastUpdateDate.getTime(),
      );

      // If records are left, we had the people to the notification pile
      if (relevantRecords.length > 0) {
        filteredUpdates.push({
          people: peopleUpdate.people,
          records: relevantRecords,
        });
      }
    }
  }

  if (filteredUpdates.length == 0) {
    return;
  }
  let notification_text = "📢 ";

  if (filteredUpdates.length > 1) {
    notification_text +=
      "Nouvelles publications pour les personnes que vous suivez :\n\n";
  }

  for (const peopleUpdate of filteredUpdates) {
    const prenomNom = `${peopleUpdate.people.prenom} ${peopleUpdate.people.nom}`;
    const prenomNomLink = `[${prenomNom}](https://jorfsearch.steinertriples.ch/name/${encodeURI(
      prenomNom,
    )})`;

    const records = peopleUpdate.records;
    // Reverse array to freshest records at the bottom
    records.reverse();

    const pluralHandler = peopleUpdate.records.length > 1 ? "s" : "";

    notification_text += `Nouvelle${pluralHandler} publication${pluralHandler} pour ${prenomNomLink}\n\n`;
    notification_text += formatSearchResult(records, {
      isListing: true,
    });

    if (filteredUpdates.indexOf(peopleUpdate) + 1 !== filteredUpdates.length)
      notification_text += "====================\n\n";

    notification_text += "\n";
  }

  await sendLongMessageFromAxios(user, notification_text, BOT_TOKEN);

  await umami.log({ event: "/notification-update-people" });
}

async function sendForcedTagUpdates(
  user: IUser,
  tagMap: [[FunctionTags], JORFSearchItem[]][],
  BOT_TOKEN: string,
) {
  let notification_text = "📢 ";

  const tagList = Object.keys(tagMap) as FunctionTags[];

  if (tagList.length == 0) {
    return;
  }

  if (tagList.length > 1) {
    notification_text +=
      "Nouvelles publications pour les fonctions que suivez :\n\n";
  }

  for (const tag of tagList) {
    const records: JORFSearchItem[] = tagMap[tag];
    // Reverse array to freshest records at the bottom
    records.reverse();

    const pluralHandler = records.length > 1 ? "s" : "";
    notification_text += `Nouvelle${pluralHandler} publication${pluralHandler} pour *${tag}*\n\n`;

    for (const record of records) {
      const prenomNom = `${record.prenom} ${record.nom}`;
      const prenomNomLink = `[${prenomNom}](https://jorfsearch.steinertriples.ch/name/${encodeURI(
        prenomNom,
      )})`;
      notification_text += `${prenomNomLink}\n`;
      notification_text += formatSearchResult([record], {
        isListing: true,
      });
      if (records.indexOf(record) + 1 !== records.length)
        notification_text += "\n";
    }

    if (tagList.indexOf(tag) + 1 !== tagList.length)
      notification_text += "====================\n\n";

    notification_text += "\n";
  }

  await sendLongMessageFromAxios(user, notification_text, BOT_TOKEN);

  await umami.log({ event: "/notification-update-tag" });
}

async function sendLongMessageFromAxios(
  user: IUser,
  message: string,
  BOT_TOKEN: string,
) {
  const messagesArray = splitText(message, 3000);

  for (const message of messagesArray) {
    await axios
      .post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: user.chatId as ChatId,
        text: message,
        parse_mode: "markdown",
        link_preview_options: {
          is_disabled: true,
        },
      })
      .catch(async (err: unknown) => {
        const error = err as AxiosError;
        if (
          (error.response.data.description as string) ===
          "Forbidden: bot was blocked by the user"
        ) {
          await umami.log({ event: "/user-blocked-joel" });
          await new Blocked({
            chatId: user.chatId as ChatId,
          }).save();
          return;
        }
        console.log(error.message);
      });

    // prevent hitting Telegram API rate limit
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
