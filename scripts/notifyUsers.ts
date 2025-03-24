require("dotenv").config();
import { ChatId } from "node-telegram-bot-api";
const mongoose = require("mongoose");
import People from "../models/People";
import User from "../models/User";
import Blocked from "../models/Blocked";
import axios from "axios";
const { formatSearchResult } = require("../utils/formatSearchResult");
import { splitText } from "../utils/sendLongText";
import { Types } from "mongoose";
const umami = require("../utils/umami");
const { ChatId } = require("node-telegram-bot-api");

type IUser = {
  chatId: number;
  _id: number;
  followedPeople: {
    peopleId: string;
    lastUpdate: Date;
  }[];
  followedFunctions: string[];
  save: () => any;
};

async function filterOutBlockedUsers(users: any[]): Promise<IUser[]> {
  const blockedUsers = await Blocked.find({}, { chatId: 1 });
  for (let blockedUser of blockedUsers) {
    users = users.filter(
      (user) => user.chatId.toString() !== blockedUser.chatId.toString()
    );
  }
  return users;
}

// only retrieve people who have been updated on same day
async function getPeople() {
  // get date in format YYYY-MM-DD
  const currentDate = new Date().toISOString().split("T")[0];
  // const currentDate = "2024-02-18";
  const people = await People.find(
    {
      updatedAt: {
        $gte: new Date(currentDate),
      },
    },
    { _id: 1, lastKnownPosition: 1, updatedAt: 1 }
  );
  return people;
}

// the argument is a list of _id of people who have been updated
// retrieve all users who follow at least one of these people
async function getUsers(updatedPeople: string[]) {
  const peopleIdStringArray = returnIdsArray(updatedPeople).map((id: any) =>
    id.toString()
  );
  const currentDate = new Date().toISOString().split("T")[0];
  const users: IUser[] = await User.find(
    {
      $or: [
        {
          followedPeople: {
            $elemMatch: {
              peopleId: {
                $in: peopleIdStringArray,
              },
            },
          },
        },
        {
          followedFunctions: {
            $ne: [],
          },
        },
      ],
    },
    { _id: 1, followedPeople: 1, followedFunctions: 1, chatId: 1 }
  ).then(async (res: any[]) => {
    return await filterOutBlockedUsers(res);
  });

  for (let user of users) {
    let followed: {
      peopleId: string;
      lastUpdate: Date;
    }[] = [];
    for (let followedPerson of user.followedPeople) {
      const idUpdated = peopleIdStringArray.includes(
        followedPerson.peopleId.toString()
      );
      const lastUpdate = new Date(followedPerson.lastUpdate)
        .toISOString()
        .split("T")[0];
      if (idUpdated && lastUpdate !== currentDate) {
        followed.push(followedPerson);
      }
    }
    user.followedPeople = followed;
  }
  return users;
}

async function sendUpdate(user: IUser, peopleUpdated: string | any[]) {
  if (!user.chatId) {
    return;
  }

  const tagsList = user.followedFunctions;
  let peopleFromFunctions:
    | {
        [x: string]: any;
      }
    | any = {};
  if (tagsList) {
    for (let tag of tagsList) {
      let listOfPeopleFromTag = await People.find(
        {
          [`lastKnownPosition.${tag}`]: {
            $exists: true,
          },
          updatedAt: {
            $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
        { _id: 1, lastKnownPosition: 1, updatedAt: 1 }
      );
      if (listOfPeopleFromTag.length > 0) {
        peopleFromFunctions[tag] = listOfPeopleFromTag;
      }
    }
  }

  if (Object.keys(peopleFromFunctions).length > 0 || peopleUpdated.length > 0) {
    let notification_text =
      "📢 Aujourd'hui, il y a eu de nouvelles publications pour les personnes que vous suivez !\n\n";

    for (let person of peopleUpdated) {
      let prenomNom = `${person.lastKnownPosition.prenom} ${person.lastKnownPosition.nom}`;
      let prenomNomLink = `[${prenomNom}](https://jorfsearch.steinertriples.ch/name/${encodeURI(
          prenomNom)})`;
      notification_text += `Nouvelle publication pour ${prenomNomLink}\n`;
      notification_text += formatSearchResult([person.lastKnownPosition], {
        isListing: true,
      });
      if (peopleUpdated.indexOf(person) + 1 !== peopleUpdated.length) {
        notification_text += "\n";
      } else {
        await umami.log({ event: "/notification-people" });
      }
    }

    for (let tag in peopleFromFunctions) {
      notification_text += "====================\n\n";
      notification_text += `Nouvelle publication pour les personnes suivies avec le tag *${tag}*:\n\n`;
      for (let person of peopleFromFunctions[tag]) {
        let prenomNom = `${person.lastKnownPosition.prenom} ${person.lastKnownPosition.nom}`;
        let prenomNomLink = `[${prenomNom}](https://jorfsearch.steinertriples.ch/name/${encodeURI(
            prenomNom)})`;
        notification_text += `${prenomNomLink}\n`;
        notification_text += formatSearchResult([person.lastKnownPosition], {
          isListing: true,
        });
        if (
          peopleFromFunctions[tag].indexOf(person) + 1 ===
          peopleFromFunctions[tag].length
        )
          notification_text += "\n";
      }
      if (
        Object.keys(peopleFromFunctions).indexOf(tag) + 1 !==
        Object.keys(peopleFromFunctions).length
      ) {
        notification_text += "\n";
      } else {
        await umami.log({ event: "/notification-function" });
      }
    }

    const messagesArray = splitText(notification_text, 3000);

    let blocked = false;
    let alreadyNotified: ChatId[] = [];
    for await (let message of messagesArray) {
      if (blocked) return;
      if (alreadyNotified.includes(user.chatId)) {
        return;
      }
      await axios
        .post(
          `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
          {
            chat_id: user.chatId,
            text: message,
            parse_mode: "markdown",
            link_preview_options: {
              is_disabled: true,
            },
          }
        )
        .catch(async (err) => {
          if (
            err.response.data.description ===
            "Forbidden: bot was blocked by the user"
          ) {
            await umami.log({ event: "/user-blocked-joel" });
            await new Blocked({
              chatId: user.chatId,
            }).save();
            blocked = true;
            return;
          }
          console.log(err.message);
        });
    }

    await umami.log({ event: "/notification-function" });
  }
}

async function populatePeople(user: IUser, peoples: any[]) {
  const peopleUpdated: {
    _id: any;
    lastKnownPosition: {
      prenom: string;
      nom: string;
    };
  }[] = [];
  for await (let followedPerson of user.followedPeople) {
    const person = peoples.find(
      (person) => person._id.toString() === followedPerson.peopleId.toString()
    );
    if (person) {
      peopleUpdated.push(person);
    }
  }
  return peopleUpdated;
}

async function updateUser(
  user: IUser,
  peoples: {
    _id: Types.ObjectId;
    nom: string;
    prenom: string;
    lastKnownPosition: any[];
  }[]
) {
  const peoplesIdArray: string[] = returnIdsArray(peoples).map((id) =>
    (id as ChatId).toString()
  );
  const userFromDb: IUser = (await User.findById(user._id)) as IUser;

  for (let followedPerson of userFromDb.followedPeople) {
    if (peoplesIdArray.includes(followedPerson.peopleId.toString())) {
      followedPerson.lastUpdate = new Date();
    }
  }
  // remove duplicated in followedPeople array that have same peopleId (can happen if user has followed a person twice)
  userFromDb.followedPeople = userFromDb.followedPeople.filter(
    (
      followedPerson: { peopleId: { toString: () => any } },
      index: any,
      self: any[]
    ) =>
      index ===
      self.findIndex(
        (t) => t.peopleId.toString() === followedPerson.peopleId.toString()
      )
  );
  // save user
  await userFromDb.save();
}

async function notifyUsers(
  users: IUser[],
  peoples: {
    _id: Types.ObjectId;
    nom: string;
    prenom: string;
    lastKnownPosition: any;
  }[]
) {
  for await (let user of users) {
    // create an array of people who have been updated
    let peopleUpdated = await populatePeople(user, peoples);
    if (peopleUpdated.length || user.followedFunctions.length) {
      // remove duplicates from peopleUpdated array
      peopleUpdated = peopleUpdated.filter(
        (person, index, self) =>
          index ===
          self.findIndex((t) => t._id.toString() === person._id.toString())
      );
      // update field updatedAt in followedPeople
      await updateUser(user, peoples);
      // send notification to user
      await sendUpdate(user, peopleUpdated);
    }
    // prevent hitting Telegram API rate limit
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function returnIdsArray(
  arr:
    | {
        _id: any;
      }[]
    | any[]
) {
  let res: string[] = [];
  for (let item of arr) {
    res.push(item._id);
  }
  return res;
}

mongoose
  .connect(process.env.MONGODB_URI || "")
  .then(async () => {
    await umami.log({ event: "/autom-notify-start" });

    // 1. get all people who have been updated today
    const peoples = await getPeople();
    if (peoples.length === 0) {
      process.exit(0);
    }
    const peopleIds = returnIdsArray(peoples);
    // 2. get all users who follow at least one of these people
    const users = await getUsers(peopleIds);
    // 3. send notification to users
    await notifyUsers(users, peoples);

    await umami.log({ event: "/autom-notify-end" });
    process.exit(0);
  })
  .catch((err: any) => {
    console.log(err);
    process.exit(1);
  });
