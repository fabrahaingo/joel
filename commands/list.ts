import User from "../models/User";
import People from "../models/People";
import { sendLongText } from "../utils/sendLongText";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";
import { FunctionTags } from "../entities/FunctionTags";
import { IUser } from "../types";
import { startKeyboard } from "../utils/keyboards";

// return the first key matching the given value
function getKeyName(value: string) {
  for (let key in FunctionTags) {
    if (FunctionTags[key as keyof typeof FunctionTags] === value) {
      return key;
    }
  }
  return value;
}

function sortArrayAlphabetically(array: string[]) {
  array.sort((a, b) => {
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
    return 0;
  });
  return array;
}

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
  const chatId = msg.chat.id;

  await umami.log({ event: "/list" });

  try {
    await bot.sendChatAction(chatId, "typing");

    const noDataText=
      `Vous ne suivez aucun contact ni fonction pour le moment. Cliquez sur *🧩 Ajouter un contact* pour commencer à suivre des contacts.`;

    // Search for a registered user: don't create one if it doesn't exist
    const user: IUser | null = await User.findOne({ _id: msg.chat.id });

    if (user === null) {
      await bot.sendMessage(msg.chat.id, noDataText, startKeyboard);
      return;
    }

    // get array of ids of people
    let peopleIds = user.followedPeople.map((p) => p.peopleId);
    let peoples = await People.find({ _id: { $in: peopleIds } })
      .collation({ locale: "fr" })
      .sort({ nom: 1 })
      .lean();
    let functions = sortArrayAlphabetically(user.followedFunctions);

    if (peoples.length === 0 && functions.length === 0) {
      await bot.sendMessage(msg.chat.id, noDataText, startKeyboard);
      return;
    }

    let text = "";
    if (functions.length > 0) {
      text += `Voici les fonctions que vous suivez: \n\n`;
      for (let j = 0; j < functions.length; j++) {
        text += `${j + 1}. *${getKeyName(
          functions[j]
        )}* - [JORFSearch](https://jorfsearch.steinertriples.ch/tag/${encodeURI(
          functions[j]
        )})\n\n`;
      }
    }
    if (peoples.length > 0) {
      text += `Voici les personnes que vous suivez: \n\n`;
      for (let i = 0; i < peoples.length; i++) {
        let nomPrenom = `${peoples[i].nom} ${peoples[i].prenom}`;
        // JORFSearch needs a search query in this specific order
        let prenomNom = `${peoples[i].prenom} ${peoples[i].nom}`;
        text += `${
          i + 1
        }. *${nomPrenom}* - [JORFSearch](https://jorfsearch.steinertriples.ch/name/${encodeURI(
          prenomNom
        )})\n`;
        if (peoples[i + 1]) {
          text += `\n`;
        }
      }
    }

    await sendLongText(bot, chatId, text);
  } catch (error) {
    console.log(error);
  }
};
