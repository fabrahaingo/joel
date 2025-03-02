import User from "../models/User";
import People from "../models/People";
import { sendLongText } from "../utils/sendLongText";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";
import { FunctionTags } from "../entities/FunctionTags";
import { IOrganisation, IPeople } from "../types";
import Organisation from "../models/Organisation";

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

    let text = "";
    let user = await User.firstOrCreate({
      tgUser: msg.from,
      chatId: msg.chat.id,
    });

    const peoples: IPeople[] = await People.find({
      _id: { $in: user.followedPeople.map((p) => p.peopleId) },
    })
        .collation({ locale: "fr" })
        .sort({ nom: 1 })
        .lean();
    const functions = sortArrayAlphabetically(user.followedFunctions);
    const organisations: IOrganisation[] = await Organisation.find({
      wikidata_id: {
        $in: user.followedOrganisations.map((o) => o.wikidata_id),
      },
    })
        .collation({ locale: "fr" })
        .sort({ nom: 1 })
        .lean();
    if (
        peoples.length === 0 &&
        organisations.length === 0 &&
        functions.length === 0
    ) {
      text = `Vous ne suivez aucun contact, fonction, ni organisation pour le moment. Cliquez sur *🧩 Ajouter un contact* pour commencer à suivre des contacts.`;
    } else {
      if (functions.length > 0) {
        text += `Voici les fonctions que vous suivez: \n\n`;
        for (let j = 0; j < functions.length; j++) {
          text += `${String(j + 1)}. *${getKeyName(
              functions[j],
          )}* - [JORFSearch](https://jorfsearch.steinertriples.ch/tag/${encodeURI(
              functions[j],
          )})\n\n`;
        }
      }
      if (organisations.length > 0) {
        text += `Voici les organisations que vous suivez: \n\n`;
        for (let k = 0; k < organisations.length; k++) {
          text += `${String(
              k + 1,
          )}. *${organisations[k].nom}* - [JORFSearch](https://jorfsearch.steinertriples.ch/${encodeURI(
              organisations[k].wikidata_id,
          )})\n`;
          if (peoples[k + 1]) {
            text += `\n`;
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
      }
    }

    await sendLongText(bot, chatId, text);
  } catch (error) {
    console.log(error);
  }
};
