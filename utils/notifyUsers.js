require("dotenv").config();
const mongoose = require("mongoose");
const env = process.env;
const People = require("../models/People");
const User = require("../models/User");
const Blocked = require("../models/Blocked");
const axios = require("axios");
const { formatSearchResult } = require("../utils/formatSearchResult");
const { splitText } = require("../utils/sendLongText").default;
const { createHash } = require("node:crypto");
const { send } = require("./umami");

async function filterOutBlockedUsers(users) {
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
  // const currentDate = "2024-02-08";
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
async function getUsers(updatedPeople) {
  const peopleIdStringArray = returnIdsArray(updatedPeople).map((id) =>
    id.toString()
  );
  const currentDate = new Date().toISOString().split("T")[0];
  const users = await User.find(
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
  ).then(async (res) => {
    return await filterOutBlockedUsers(res);
  });

  for (let user of users) {
    let followed = [];
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

async function sendUpdate(user, peopleUpdated) {
  if (!user.chatId) {
    console.log(
      `Can't send notifications to ${user._id}. Must run /start again to update his chatId.`
    );
    return;
  }

  // use mongoose to retrive all people that the user follows using a tag
  // tags are stored in the user.followedFunctions array
  // we know a person belongs to a tag if the tag is a key in the person lastKnownPosition object which equals to the string "true"
  const tagsList = user.followedFunctions;
  let peopleFromFunctions = {};
  if (tagsList) {
    for (let tag of tagsList) {
      // get all people that have a lastKnownPosition object with a key that equals to the tag
      // and that have been updated today
      let listOfPeopleFromTag = await People.find(
        {
          [`lastKnownPosition.${tag}`]: {
            $exists: true,
          },
          updatedAt: {
            $gte: new Date(new Date().toISOString().split("T")[0]),
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
      notification_text += `Nouvelle publication pour *${person.lastKnownPosition.prenom} ${person.lastKnownPosition.nom}*\n`;
      notification_text += formatSearchResult([person.lastKnownPosition], {
        isListing: true,
      });
      if (peopleUpdated.indexOf(person) + 1 !== peopleUpdated.length)
        notification_text += "\n";
    }

    for (let tag in peopleFromFunctions) {
      notification_text += "====================\n\n";
      notification_text += `Nouvelle publication pour les personnes suivies avec le tag *${tag}*:\n\n`;
      for (let person of peopleFromFunctions[tag]) {
        notification_text += `*${person.lastKnownPosition.prenom} ${person.lastKnownPosition.nom}*\n`;
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
      )
        notification_text += "\n";
    }

    const messagesArray = splitText(notification_text, 3000);

    let blocked = false;
    for await (let message of messagesArray) {
      if (blocked) return;
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
            await send("/user-blocked-joel", {
              chatId: createHash("sha256")
                .update(user.chatId.toString())
                .digest("hex"),
            });
            await new Blocked({
              chatId: user.chatId,
            }).save();
            blocked = true;
            return;
          }
          console.log(err.message);
        });
    }

    await send("/notification-update", {
      chatId: createHash("sha256").update(user.chatId.toString()).digest("hex"),
    });

    console.log(`Sent notification to ${user._id}`);
  }
}

async function populatePeople(user, peoples) {
  const peopleUpdated = [];
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

async function updateUser(user, peoples) {
  const peoplesIdArray = returnIdsArray(peoples).map((id) => id.toString());
  const userFromDb = await User.findById(user._id);

  for (let followedPerson of userFromDb.followedPeople) {
    if (peoplesIdArray.includes(followedPerson.peopleId.toString())) {
      followedPerson.lastUpdate = new Date();
    }
  }
  // remove duplicated in followedPeople array that have same peopleId (can happen if user has followed a person twice)
  userFromDb.followedPeople = userFromDb.followedPeople.filter(
    (followedPerson, index, self) =>
      index ===
      self.findIndex(
        (t) => t.peopleId.toString() === followedPerson.peopleId.toString()
      )
  );
  // save user
  await userFromDb.save();
}

async function notifyUsers(users, peoples) {
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

function returnIdsArray(arr) {
  let res = [];
  for (let item of arr) {
    res.push(item._id);
  }
  return res;
}

mongoose
  .connect(env.MONGODB_URI)
  .then(async () => {
    // 1. get all people who have been updated today
    const peoples = await getPeople();
    const peopleIds = returnIdsArray(peoples);
    // 2. get all users who follow at least one of these people
    const users = await getUsers(peopleIds);
    // 3. send notification to users
    await notifyUsers(users, peoples);
    process.exit(0);
  })
  .catch((err) => {
    console.log(err);
    process.exit(1);
  });
