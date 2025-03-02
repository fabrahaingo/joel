import User from "../models/User";
import People from "../models/People";
import { sendLongText } from "../utils/sendLongText";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";
import { FunctionTags } from "../entities/FunctionTags";
import { IOrganisation, IPeople } from "../types";
import Organisation from "../models/Organisation";

export function getFunctionsFromValues(
  values: FunctionTags[],
): (keyof typeof FunctionTags)[] {
  if (values.length === 0) return [];

  const tagValues = Object.values(FunctionTags);
  const tagKeys = Object.keys(FunctionTags) as (keyof typeof FunctionTags)[];

  return values.map((tag) => tagKeys[tagValues.indexOf(tag)]);
}

// return the first key matching the given value
function getKeyName(value: FunctionTags): keyof typeof FunctionTags {
  return getFunctionsFromValues[value];
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
    const user = await User.firstOrCreate({
      tgUser: msg.from,
      chatId: msg.chat.id,
    });

    const peoples: IPeople[] = await People.find({
      _id: { $in: user.followedPeople.map((p) => p.peopleId) },
    })
      .collation({ locale: "fr" })
      .sort({ nom: 1 })
      .lean();
    const functions = sortArrayAlphabetically(
      user.followedFunctions,
    ) as FunctionTags[];
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
        const functionsKeys = getFunctionsFromValues(functions);
        for (let j = 0; j < functions.length; j++) {
          text += `${String(j + 1)}. *${functionsKeys[j]}* - [JORFSearch](https://jorfsearch.steinertriples.ch/tag/${encodeURI(
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
            const nomPrenom = `${peoples[i].nom} ${peoples[i].prenom}`;
            // JORFSearch needs a search query in this specific order
            const prenomNom = `${peoples[i].prenom} ${peoples[i].nom}`;
            text += `${
              i + 1
            }. *${nomPrenom}* - [JORFSearch](https://jorfsearch.steinertriples.ch/name/${encodeURI(
              prenomNom,
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
