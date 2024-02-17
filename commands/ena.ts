import axios from "axios";
import { sendLongText } from "../utils/sendLongText";
import User from "../models/User";
import People from "../models/People";
import { startKeyboard } from "../utils/keyboards";
import { createHash } from "node:crypto";
import umami from "../utils/umami";
import { Types } from "mongoose";
import { IUser, PromoENA, PromoINSP } from "../types";
import TelegramBot from "node-telegram-bot-api";

function removeAccents(input: string): string {
  input = input.trim().toLowerCase();

  input = input.replace(/[àáâãäå]/g, "a");
  input = input.replace(/[èéêë]/g, "e");
  input = input.replace(/[ìíîï]/g, "i");
  input = input.replace(/[òóôõö]/g, "o");
  input = input.replace(/[ùúûü]/g, "u");
  input = input.replace(/[ç]/g, "c");

  return input;
}

// https://stackoverflow.com/questions/53606337/check-if-array-contains-all-elements-of-another-array
let checker = (arr: string[], target: string) =>
  target.split(" ").every((v) => arr.includes(v));

function findPromoName(args: {
  input: string | undefined;
  promoNames: string[];
}): string | undefined {
  if (!args.input) return;
  let promoNamesArray = args.promoNames.map((name) => name.split(" "));
  const clean = removeAccents(args.input);
  for (let i = 0; i < promoNamesArray.length; i++) {
    if (checker(promoNamesArray[i], clean)) {
      return args.promoNames[i];
    }
  }
  return;
}

async function getJORFSearchResult(year: string, institution: string) {
  if (year === "") {
    return [];
  }
  if (institution === "ENA") {
    let url = `https://jorfsearch.steinertriples.ch/tag/eleve_ena=%22${year}%22?format=JSON`;
    const res = await axios.get(url).then((response) => {
      return response.data;
    });
    return res;
  }
  const inspId = "Q109039648";
  let url = `https://jorfsearch.steinertriples.ch/${inspId}?format=JSON`;
  const res = await axios.get(url).then((response) => {
    return response.data.filter(
      (publication: { type_ordre: string; date_fin: string }) => {
        // only keep publications objects that contain "type_ordre":"admission" and where "date_fin":"2024-10-31" the first 4 characters of date_fin are equal to the 4 last characters of year
        return (
          publication.type_ordre === "admission" &&
          publication.date_fin.slice(0, 4) === year.slice(-4)
        );
      }
    );
  });
  return res;
}

function capitalizeFirstLetters(str: string | undefined): string {
  if (!str) return "";
  try {
    return str.replace(/\b\w/g, (l) => l.toUpperCase());
  } catch (e) {
    console.log(e);
    return str;
  }
}

async function searchPersonOnJORF(person: string): Promise<any> {
  return await axios
    .get(
      encodeURI(
        `https://jorfsearch.steinertriples.ch/name/${person}?format=JSON`
      )
    )
    .then(async (res) => {
      if (res.data?.length === 0) {
        return res;
      }
      if (res.request.res.responseUrl) {
        return await axios.get(
          res.request.res.responseUrl.endsWith("?format=JSON")
            ? res.request.res.responseUrl
            : `${res.request.res.responseUrl}?format=JSON`
        );
      }
    });
}

function isPersonAlreadyFollowed(
  id: Types.ObjectId,
  followedPeople: IUser["followedPeople"]
): boolean {
  return followedPeople.some((person) => person.peopleId.equals(id));
}

function getYearFromPromo(promoName: string | undefined): string {
  if (!promoName) return "";
  if (promoName in PromoENA) {
    return PromoENA[promoName as keyof typeof PromoENA];
  }
  if (promoName in PromoINSP) {
    return PromoINSP[promoName as keyof typeof PromoINSP];
  }
  return "";
}

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
  try {
    const chatId = msg.chat.id;
    await umami.log({ event: "/ena" });
    const text = `Entrez le nom de votre promo (ENA ou INSP) et l'*intégralité de ses élèves* sera ajoutée à la liste de vos contacts.\n
⚠️ Attention, beaucoup de personnes seront ajoutées en même temps, *les retirer peut ensuite prendre du temps* ⚠️`;
    const question = await bot.sendMessage(msg.chat.id, text, {
      parse_mode: "Markdown",
      reply_markup: {
        force_reply: true,
      },
    });
    let JORFSearchRes: any[] = [];
    bot.onReplyToMessage(chatId, question.message_id, async (msg) => {
      let institution = "";
      let promoName: string | undefined = undefined;

      const ENAPromo = findPromoName({
        input: msg.text,
        promoNames: Object.keys(PromoENA),
      });
      if (ENAPromo) {
        institution = "ENA";
        promoName = Object.keys(PromoENA).find(
          (key) => PromoENA[key as keyof typeof PromoENA] === ENAPromo
        );
      }

      const INSPPromo = findPromoName({
        input: msg.text,
        promoNames: Object.keys(PromoINSP),
      });
      if (INSPPromo) {
        institution = "INSP";
        promoName = Object.keys(PromoINSP).find(
          (key) => PromoINSP[key as keyof typeof PromoINSP] === INSPPromo
        );
      }

      JORFSearchRes = await getJORFSearchResult(
        getYearFromPromo(ENAPromo || INSPPromo),
        institution
      );

      let text = `La promotion *${capitalizeFirstLetters(
        promoName
      )}* contient *${JORFSearchRes.length} élèves*:`;
      if (JORFSearchRes.length > 0) {
        await bot.sendMessage(chatId, text, {
          parse_mode: "Markdown",
        });
      } else {
        return await bot.sendMessage(
          chatId,
          "Promo introuvable",
          startKeyboard
        );
      }
      // wait 2 seconds
      await new Promise((resolve) => setTimeout(resolve, 2000));
      // sort JORFSearchRes by last name
      JORFSearchRes.sort((a, b) => {
        if (a.nom < b.nom) return -1;
        if (a.nom > b.nom) return 1;
        return 0;
      });
      // send all contacts
      const contacts = JORFSearchRes.map((contact) => {
        return `${contact.nom} ${contact.prenom}`;
      });
      await sendLongText(bot, chatId, contacts.join("\n"));
      const followConfirmation = await bot.sendMessage(
        chatId,
        `Voulez-vous ajouter ces personnes à vos contacts ? (répondez *oui* ou *non*)\n\n⚠️ Attention : *les retirer peut ensuite prendre du temps*`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            force_reply: true,
          },
        }
      );
      bot.onReplyToMessage(
        chatId,
        followConfirmation.message_id,
        async (msg) => {
          if (msg.text === undefined) {
            return await bot.sendMessage(
              chatId,
              `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /ena.`
            );
          }
          if (new RegExp(/oui/i).test(msg.text)) {
            await bot.sendMessage(
              chatId,
              `Ajout en cours... Cela peut prendre plusieurs minutes. ⏰`
            );
            const tgUser = msg.from;
            let user = await User.firstOrCreate({ tgUser, chatId });
            for (let i = 0; i < JORFSearchRes.length; i++) {
              const contact = JORFSearchRes[i];
              const search = await searchPersonOnJORF(
                `${contact.prenom} ${contact.nom}`
              );
              if (search.data?.length) {
                const people = await People.firstOrCreate({
                  nom: search.data[0].nom,
                  prenom: search.data[0].prenom,
                  lastKnownPosition: search.data[0],
                });
                await people.save();

                if (!isPersonAlreadyFollowed(people._id, user.followedPeople)) {
                  user.followedPeople.push({
                    peopleId: people._id,
                    lastUpdate: new Date(),
                  });
                }
              }
            }
            await user.save();
            return await bot.sendMessage(
              chatId,
              `Les *${
                JORFSearchRes.length
              } personnes* de la promo *${capitalizeFirstLetters(
                promoName
              )}* ont été ajoutées à vos contacts.`,
              startKeyboard
            );
          } else if (new RegExp(/non/i).test(msg.text)) {
            return await bot.sendMessage(
              chatId,
              `Ok, aucun ajout n'a été effectué. 👌`
            );
          }
          await bot.sendMessage(
            chatId,
            `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /ena.`
          );
        }
      );
    });
  } catch (error) {
    console.log(error);
  }
};
