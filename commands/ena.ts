import { sendLongText } from "../utils/sendLongText";
import User from "../models/User";
import People from "../models/People";
import { startKeyboard } from "../utils/keyboards";
import umami from "../utils/umami";
import { Types } from "mongoose";
import { IUser, WikiDataId } from "../types";
import {
  Promo_ENA_INSP,
  ListPromos_INSP_ENA_all,
  ListPromos_INSP_available,
  ListPromos_ENA_available,
  ListPromos_ENA_unavailable,
} from "../entities/PromoNames";
import TelegramBot from "node-telegram-bot-api";
import { JORFSearchItem } from "../entities/JORFSearchResponse";
import { callJORFSearchOrganisation, callJORFSearchPeople, callJORFSearchTag } from "../utils/JORFSearch.utils";

export function removeAccents(input: string): string {
    input = input.trim().toLowerCase();

    input = input.replace(/[àáâãäå]/g, "a");
    input = input.replace(/[èéêë]/g, "e");
    input = input.replace(/[ìíîï]/g, "i");
    input = input.replace(/[òóôõö]/g, "o");
    input = input.replace(/[ùúûü]/g, "u");
    input = input.replace(/[ç]/g, "c");
    input = input.replace(/[œ]/g, "oe");

    return input;
}

function findENAINSPPromo(input: string): Promo_ENA_INSP | null {
  const allPromos = ListPromos_INSP_ENA_all;
  const allPromoNames = allPromos.map((i) =>
    i.name
      ? removeAccents(i.name.toLowerCase()).replaceAll("-", " ")
      : undefined,
  );
  const allPromoPeriods = allPromos.map((i) => i.formattedPeriod);

  let promoIdx = allPromoNames.findIndex(
    (i) => i === removeAccents(input.toLowerCase().replaceAll("-", " ")),
  );

  if (promoIdx === -1) {
    promoIdx = allPromoPeriods.findIndex(
      (i) => i === input.replaceAll("/", "-"),
    );
  }

  // Promo not found
  if (promoIdx === -1) {
    return null;
  }

  // Promo found
  // The full promo list is in order: INSP / ENA_available / ENA_unavailable

  // Promo in INSP
  if (promoIdx < ListPromos_INSP_available.length) {
    return ListPromos_INSP_available[promoIdx];
  }

  promoIdx = promoIdx - ListPromos_INSP_available.length;

  if (promoIdx < ListPromos_ENA_available.length) {
    return ListPromos_ENA_available[promoIdx];
  }

  promoIdx = promoIdx - ListPromos_ENA_available.length;

  return ListPromos_ENA_unavailable[promoIdx];
}

async function getJORFPromoSearchResult(
    promoInfo: Promo_ENA_INSP | null,
): Promise<JORFSearchItem[] | null> {
    if (promoInfo === null) {
        return null;
    }

  switch (promoInfo.promoType) {

    case "ENA": // If ENA, we can use the associated tag with the year as value
      return callJORFSearchTag("eleve_ena", promoInfo.formattedPeriod);

    case "INSP": // If INSP, we can rely on the associated organisation
      const inspId = "Q109039648" as WikiDataId;
      return (await callJORFSearchOrganisation(inspId))
          // We filter to keep admissions to the INSP organisation from the relevant year
          .filter(
            (publication) => {
              // only keep publications objects that contain "type_ordre":"admission" and where "date_fin":"2024-10-31" the first 4 characters of date_fin are equal to the 4 last characters of year
              return (
                  publication?.type_ordre === "admission" && publication?.date_fin &&
                  publication?.date_fin.slice(0, 4) === promoInfo.formattedPeriod.slice(-4)
              );
            });
  }
  return []
}

function isPersonAlreadyFollowed(
    id: Types.ObjectId,
    followedPeople: IUser["followedPeople"],
): boolean {
    return followedPeople.some((person) => person.peopleId.equals(id));
}

export const enaCommand =
  (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
    try {
      const chatId = msg.chat.id;
      await umami.log({ event: "/ena" });
      const text = `Entrez le nom de votre promo (ENA ou INSP) et l'*intégralité de ses élèves* sera ajoutée à la liste de vos contacts.\n
⚠️ Attention, un nombre important de suivis seront ajoutées en même temps, *les retirer peut ensuite prendre du temps* ⚠️\n
Formats acceptés:
Georges-Clemenceau
2017-2018\n
Utilisez la command /promos pour consulter la liste des promotions INSP et ENA disponibles.`;
      const question = await bot.sendMessage(msg.chat.id, text, {
        parse_mode: "Markdown",
        reply_markup: {
          force_reply: true,
        },
      });
      bot.onReplyToMessage(chatId, question.message_id, async (msg) => {
        if (msg.text === undefined) {
          await bot.sendMessage(
            chatId,
            `Votre réponse n'a pas été reconnue.👎\nVeuillez essayer de nouveau la commande /ena.`,
          );
          return;
        }

        // If the user used the /promos command or button
        if (RegExp(/\/promos/i).test(msg.text)) {
          promosCommand(bot);
          return;
        }

        const promoInfo = findENAINSPPromo(msg.text);
        const promoJORFList = await getJORFPromoSearchResult(promoInfo);

        if (promoInfo && !promoInfo.onJORF) {
          await bot.sendMessage(
            chatId,
            `La promotion *${promoInfo.fullStr}* n'est pas disponible dans les archives du JO.
Utilisez la commande /promos pour consulter la liste des promotions INSP et ENA disponibles.`,
            startKeyboard,
          );
          return;
        }

        if (
          promoInfo === null ||
          promoJORFList === null ||
          promoJORFList.length == 0
        ) {
          await bot.sendMessage(
            chatId,
            `La promotion n'a pas été reconnue.👎\nVeuillez essayer de nouveau la commande /ena`,
            startKeyboard,
          );
          return;
        }

        const text = `La promotion *${promoInfo.fullStr}* contient *${String(promoJORFList.length)} élèves*:`;
        await bot.sendMessage(chatId, text, {
          parse_mode: "Markdown",
        });

        // wait 2 seconds
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // sort JORFSearchRes by upper last name: to account for French "particule"
        promoJORFList.sort((a, b) => {
          if (a.nom.toUpperCase() < b.nom.toUpperCase()) return -1;
          if (a.nom.toUpperCase() > b.nom.toUpperCase()) return 1;
          return 0;
        });
        // send all contacts
        const contacts = promoJORFList.map((contact) => {
          return `${contact.nom} ${contact.prenom}`;
        });
        await sendLongText(bot, chatId, contacts.join("\n"));
        const followConfirmation = await bot.sendMessage(
          chatId,
          `Voulez-vous ajouter ces personnes à vos suivis ? (répondez *oui* ou *non*)\n\n⚠️ Attention : *les retirer peut ensuite prendre du temps*`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              force_reply: true,
            },
          },
      );
      bot.onReplyToMessage(
        chatId,
        followConfirmation.message_id,
        async (msg) => {
          if (msg.text === undefined) {
            await bot.sendMessage(
              chatId,
              `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /ena.`
            );
            return;
          }
          if (new RegExp(/oui/i).test(msg.text)) {
            await bot.sendMessage(
              chatId,
              `Ajout en cours... Cela peut prendre plusieurs minutes. ⏰`
            );
            await bot.sendChatAction(chatId, "typing");
            const user = await User.firstOrCreate({
              tgUser: msg.from,
              chatId,
            });
            for (const contact of promoJORFList) {
                const people_data = await callJORFSearchPeople(
                    `${contact.prenom} ${contact.nom}`
                );
                if (people_data.length > 0) {
                    const people = await People.firstOrCreate({
                        nom: people_data[0].nom,
                        prenom: people_data[0].prenom,
                        lastKnownPosition: people_data[0],
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
              await bot.sendMessage(
                chatId,
                `Les *${String(
                  promoJORFList.length,
                )} personnes* de la promo *${promoInfo.fullStr}* ont été ajoutées à vos contacts.`,
                startKeyboard,
              );
              return;
            } else if (new RegExp(/non/i).test(msg.text)) {
              await bot.sendMessage(
                chatId,
                `Ok, aucun ajout n'a été effectué. 👌`,
                startKeyboard,
              );
              return;
            }
            await bot.sendMessage(
              chatId,
              `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /ena.`,
              startKeyboard,
            );
          },
        );
      });
    } catch (error) {
      console.log(error);
    }
  };

export const promosCommand =
  (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
    try {
      const chatId = msg.chat.id;
      await umami.log({ event: "/INSPENAList" });
      let text = `Les périodes et noms des promotions successives sont:\n\n`;

      // Promotions INSP
      text += "*Institut National du Service Public (INSP)*\n\n";
      for (const promoINSP of ListPromos_INSP_available) {
        text += `${promoINSP.formattedPeriod} : *${promoINSP.name ?? "À venir"}*\n`;
      }

      // Promotions ENA
      text += "\n*École Nationale d'Administration (ENA)*\n\n";
      for (const promoENA of ListPromos_ENA_available) {
        text += `${promoENA.formattedPeriod} : *${promoENA.name ?? "À venir"}*\n`;
      }

      text +=
        "\nUtilisez la commande /ENA ou /INSP pour suivre la promotion de votre choix.\n\n";

      await bot.sendMessage(chatId, text, startKeyboard);
    } catch (error) {
      console.log(error);
    }
  };
