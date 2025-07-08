import User from "../models/User.js";
import People from "../models/People.js";
import { mainMenuKeyboard } from "../utils/keyboards.js";
import { IPeople, ISession, WikidataId } from "../types.js";
import { List_Promos_INSP_ENA, Promo_ENA_INSP } from "../entities/PromoNames.js";
import TelegramBot from "node-telegram-bot-api";
import { JORFSearchItem } from "../entities/JORFSearchResponse.js";
import {
    callJORFSearchOrganisation,
    callJORFSearchPeople,
    callJORFSearchTag,
    cleanPeopleName
} from "../utils/JORFSearch.utils.js";
import { extractTelegramSession, TelegramSession } from "../entities/TelegramSession.js";

const inspId = "Q109039648" as WikidataId;

function findENAINSPPromo(input: string): Promo_ENA_INSP | null {
  const allPromoPeriods = List_Promos_INSP_ENA.map((i) => i.period);

  const cleanInput = cleanPeopleName(input.toLowerCase().replaceAll("-", " "));

  let promoIdx = List_Promos_INSP_ENA
      .map((i) =>
      i.name
          ? cleanPeopleName(i.name.toLowerCase()).replaceAll("-", " ")
          : undefined,
  ).findIndex(
    (i) => i === cleanInput,
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

  return List_Promos_INSP_ENA[promoIdx];
}

async function getJORFPromoSearchResult(
    promo: Promo_ENA_INSP | null,
): Promise<JORFSearchItem[] | null> {
    if (promo === null) {
        return null;
    }

  switch (promo.school) {

    case "ENA": // If ENA, we can use the associated tag with the year as value
      return callJORFSearchTag("eleve_ena", promo.period);

    case "INSP": // If INSP, we can rely on the associated organisation
      return (await callJORFSearchOrganisation(inspId))
          // We filter to keep admissions to the INSP organisation from the relevant year
          .filter((publication) => publication.eleve_ena === promo.period);
      default:
          return [];
  }
}

export const enaCommand = async (session: ISession, _msg: never): Promise<void> => {
    try {
      await session.log({ event: "/ena" });

      const tgSession : TelegramSession | undefined = await extractTelegramSession(session, true);
      if (tgSession == null) return;
      const tgBot = tgSession.telegramBot;

      const text = `Entrez le nom de votre promo (ENA ou INSP) et l'*intégralité de ses élèves* sera ajoutée à la liste de vos contacts.\n
⚠️ Attention, un nombre important de suivis seront ajoutées en même temps, *les retirer peut ensuite prendre du temps* ⚠️\n
Formats acceptés:
Georges-Clemenceau
2017-2018\n
Utilisez la command /promos pour consulter la liste des promotions INSP et ENA disponibles.`;
      const question = await tgBot.sendMessage(session.chatId, text, {
        parse_mode: "Markdown",
        reply_markup: {
          force_reply: true,
        },
      });
      tgBot.onReplyToMessage(session.chatId, question.message_id, async (tgMsg1: TelegramBot.Message) => {
          if (tgMsg1.text == undefined || tgMsg1.text.length == 0) {
          await tgBot.sendMessage(
            session.chatId,
            `Votre réponse n'a pas été reconnue.👎\nVeuillez essayer de nouveau la commande /ena.`,
          );
          return;
        }

        // If the user used the /promos command or button
        if (RegExp(/\/promos/i).test(tgMsg1.text)) {
          await promosCommand(session);
          return;
        }

        const promoInfo = findENAINSPPromo(tgMsg1.text);
        const promoJORFList = await getJORFPromoSearchResult(promoInfo);

        if (promoInfo == null || promoJORFList == null ||promoJORFList.length == 0) {
          await session.sendMessage(
              `La promotion n'a pas été reconnue.👎\nVeuillez essayer de nouveau la commande /ena`,
              mainMenuKeyboard,
          );
          return;
        }

        const promoStr= promoInfo.name ? `${promoInfo.name} (${promoInfo.period})` : promoInfo.period;

        if (!promoInfo.onJORF) {
          await session.sendMessage(
            `La promotion *${promoStr}* n'est pas disponible dans les archives du JO car elle est trop ancienne.
Utilisez la commande /promos pour consulter la liste des promotions INSP et ENA disponibles.`,
              mainMenuKeyboard,
          );
          return;
        }

        await session.sendMessage(`La promotion *${promoStr}* contient *${String(promoJORFList.length)} élèves*:`);

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
        await session.sendMessage(contacts.join("\n"));
        const followConfirmation = await tgBot.sendMessage(
          session.chatId,
          `Voulez-vous ajouter ces personnes à vos suivis ? (répondez *oui* ou *non*)\n\n⚠️ Attention : *les retirer peut ensuite prendre du temps*`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              force_reply: true,
            },
          },
      );
      tgBot.onReplyToMessage(
        session.chatId,
        followConfirmation.message_id,
        async (tgMsg2: TelegramBot.Message) => {
          if (tgMsg2.text === undefined) {
            await session.sendMessage(
              `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /ena.`, mainMenuKeyboard
            );
            return;
          }
          if (new RegExp(/oui/i).test(tgMsg2.text)) {
            await session.sendMessage(
              `Ajout en cours... Cela peut prendre plusieurs minutes. ⏰`
            );
            await session.sendTypingAction();
            const user = await User.findOrCreate(session);

            const peopleTab: IPeople[] = [];

            for (const contact of promoJORFList) {
              const people_data= await callJORFSearchPeople(
                `${contact.prenom} ${contact.nom}`
              );
              if (people_data.length > 0) {
                const people = await People.firstOrCreate({
                  nom: people_data[0].nom,
                  prenom: people_data[0].prenom,
                });
                await people.save();
                peopleTab.push(people);
              }
            }
              await user.addFollowedPeopleBulk(peopleTab);
              await user.save();
            await session.sendMessage(
                `Les *${String(
                    peopleTab.length,
                )} personnes* de la promo *${promoStr}* ont été ajoutées à vos contacts.`,
                mainMenuKeyboard,
            );
            return;
          } else if (new RegExp(/non/i).test(tgMsg2.text)) {
            await session.sendMessage(
              `Ok, aucun ajout n'a été effectué. 👌`,
                mainMenuKeyboard
            );
            return;
          }
          await session.sendMessage(
            `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /ena.`,
              mainMenuKeyboard
          );
        }
      );
    });
  } catch (error) {
    console.log(error);
  }
};

export const promosCommand = async (session: ISession, _msg?: never): Promise<void> => {
  try {
        await session.log({ event: "/ena-list" });
        let text = `Les périodes et noms des promotions successives sont:\n\n`;

        // Promotions INSP
        text += "*Institut National du Service Public (INSP)*\n\n";
        for (const promoINSP of List_Promos_INSP_ENA.filter(p=>p.school==="INSP")) {
            text += `${promoINSP.period} : *${promoINSP.name ?? "À venir"}*\n`;
        }

        // Promotions ENA
        text += "\n*École Nationale d'Administration (ENA)*\n\n";
        for (const promoENA of List_Promos_INSP_ENA.filter(p=>p.school==="ENA" && p.onJORF)) {
            text += `${promoENA.period} : *${promoENA.name ?? "À venir"}*\n`;
        }

        text +=
            "\nUtilisez la commande /ENA ou /INSP pour suivre la promotion de votre choix.\n\n";

        await session.sendMessage(text, mainMenuKeyboard);
    } catch (error) {
        console.log(error);
    }
};

