import "dotenv/config";
import { mongodbConnect } from "../db";
import { ErrorMessages } from "../entities/ErrorMessages";
import { JORFSearchItem } from "../entities/JORFSearchResponse";
import { FunctionTags } from "../entities/FunctionTags";
import { IPeople, IUser } from "../types";
import People from "../models/People";
import axios, { AxiosError } from "axios";
import Blocked from "../models/Blocked";
import User from "../models/User";
import { ChatId } from "node-telegram-bot-api";
import { Types } from "mongoose";
import umami from "../utils/umami";
import { dateTOJORFFormat, JORFtoDate } from "../utils/date.utils";
import { splitText } from "../utils/sendLongText";
import { formatSearchResult } from "../utils/formatSearchResult";
import {
  callJORFSearchDay,
  uniqueMinimalNameInfo
} from "../utils/JORFSearch.utils";
import { ObjectId } from "mongodb";

async function getJORFRecordsFromDate(
  startDate: Date
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
  tagvalue?: string
) {
  if (tagvalue === undefined) {
    return JORF_items.filter(
      (item) => Object.prototype.hasOwnProperty.call(item, tagName) // Check if item has tag as a field
    );
  } else {
    return JORF_items.filter(
      (item) =>
        Object.prototype.hasOwnProperty.call(item, tagName) && // Check if item has tag as a field
        item[tagName as keyof JORFSearchItem] === tagvalue // Check if tag has the required value
    );
  }
}

export function buildTagMap(
  updatedRecords: JORFSearchItem[],
  tagList: FunctionTags[]
) {
  return tagList.reduce((tagMap: [[FunctionTags], JORFSearchItem[]][], tag) => {
    // extracts the relevant tags from the daily updates
    const taggedItems = extractTaggedItems(updatedRecords, tag);
    if (taggedItems.length == 0) return tagMap; // If no tagged record: we drop the tag

    // format: {tag: [contacts], tag2: [contacts]}
    tagMap[tag as FunctionTags] = taggedItems;
    return tagMap;
  }, []);
}

async function filterOutBlockedUsers(users: IUser[]): Promise<IUser[]> {
  const blockedUsers: IUser[] = await Blocked.find({}, { _id: 1 });
  for (const blockedUser of blockedUsers) {
    users = users.filter((user) => user._id === blockedUser._id);
  }
  return users;
}

// Update the timestamp of last update of a user-specific people follow
async function updateUserFollowedPeople(
  user: IUser,
  updatedPeopleIds: Types.ObjectId[]
) {
  if (updatedPeopleIds.length == 0) {
    return; // So we don't touch the use record
  }

  const currentDate = new Date();

  user.followedPeople = user.followedPeople.reduce(
    (followedList: { peopleId: ObjectId; lastUpdate: Date }[], followed) => {
      if (
        followedList.some(
          (f) => f.peopleId.toString() === followed.peopleId.toString()
        )
      )
        return followedList; // If user follows twice the same person: we drop the second record

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
        followedList.push(followed); // otherwise we don't change the item
      }
      return followedList;
    },
    []
  );

  // save user
  await user.save();
}

// There is currently no way to check if a user has been notified of a tag update
// Resuming an update thus require to force-notify users for all tags update over the period.
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
    // send notification to user
    await sendTagUpdates(user, updatedTagMap);
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
            $in: updatedPeopleList.map((i) => i._id)
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
    return await filterOutBlockedUsers(res); // filter out user who blocked JOEL
  });

  for (const user of updatedUsers) {
    // Ids of all people followed by the user
    const peopleIdsFollowedByUser = user.followedPeople.map((j) =>
      j.peopleId.toString()
    );
    const peopleFollowedByUser = updatedPeopleList.filter((i) =>
      peopleIdsFollowedByUser.includes(i._id.toString())
    );
    const peopleInfoFollowedByUser =
      uniqueMinimalNameInfo(peopleFollowedByUser);

    // Records which are associated with followed People, and which are new for this respective People follow
    const newRecordsFollowedByUser = updatedRecords.reduce(
      (recordList: JORFSearchItem[], record) => {
        // remove records not associated with followed people
        // this the first main filter
        if (
          !peopleInfoFollowedByUser.some(
            (p) => p.nom === record.nom && p.prenom === record.prenom
          )
        )
          return recordList;

        const updatesPeopleId = peopleFollowedByUser.find(
          (i) => i.nom == record.nom && i.prenom == record.prenom
        )?._id;
        if (updatesPeopleId === undefined) return recordList; // this should not happen

        // Find the follow data associated with this People
        const followData = user.followedPeople.find(
          (i) => i.peopleId.toString() === updatesPeopleId.toString()
        );
        if (followData === undefined) return recordList; // this should not happen

        // Check that the update is newer than lastUpdate
        if (
          JORFtoDate(record.source_date).getTime() <
          followData.lastUpdate.getTime()
        )
          return recordList;

        // Record up to this point are associated to a followed People and newer than the last update
        recordList.push(record);
        return recordList;
      },
      []
    );

    // send notification to user
    await sendPeopleUpdate(user, newRecordsFollowedByUser);

    // Ids of updated peoples:
    const updatedRecordsPeopleId = peopleFollowedByUser
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

const BOT_TOKEN = process.env.BOT_TOKEN || "";

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

async function sendTagUpdates(
  user: IUser,
  tagMap: [[FunctionTags], JORFSearchItem[]][]
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

async function sendLongMessageFromAxios(user: IUser, message: string) {
  const messagesArray = splitText(message, 3000);

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
        const error = err as AxiosError;
        if (
          error.response !== undefined &&
          (error.response.data.description as string) ===
            "Forbidden: bot was blocked by the user"
        ) {
          await umami.log({ event: "/user-blocked-joel" });
          await new Blocked({
            chatId: user.chatId as ChatId
          }).save();
          return;
        }
        console.log(error.message);
      });

    // prevent hitting Telegram API rate limit
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

if (BOT_TOKEN === undefined) {
  throw new Error("BOT TOKEN NOT SET");
}

const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI === undefined) {
  throw new Error(ErrorMessages.MONGODB_URI_NOT_SET);
}

(async () => {
  // Connect to DB
  await mongodbConnect();

  // Check that the BOT TOKEN is set: to prevent computing everything for nothing ...
  if (process.env.BOT_TOKEN === undefined) {
    throw new Error("BOT TOKEN NOT SET");
  }

  // Number of days to go back : 0 means we just fetch today's info
  const shiftDays = 0;

  // currentDate is today
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

  // Send notifications to users on followed functions
  await notifyFunctionTagsUpdates(JORFAllRecordsFromDate);

  process.exit(0);
})();
