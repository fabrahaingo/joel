import { startKeyboard } from "../utils/keyboards";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";
import Organisation from "../models/Organisation";
import User from "../models/User";
import { IOrganisation, IUser, WikidataId } from "../types";
import { callJORFSearchOrganisation } from "../utils/JORFSearch.utils";
import axios from "axios";
import { sendLongText } from "../utils/sendLongText";

function parseIntAnswers(
  answer: string | undefined,
  selectionIndexMax: number,
) {
  if (answer === undefined) return null;

  const answers = answer
    .split(/[ ,\-;:]/)
    .map((s) => parseInt(s))
    .filter((i) => i && !isNaN(i) && i <= selectionIndexMax);

  if (answers.length == 0) {
    return null;
  }
  return answers;
}

const isOrganisationAlreadyFollowed = (
  user: IUser,
  wikidata_id: WikidataId,
): boolean => {
  return user?.followedOrganisations.some((o) => o.wikidata_id === wikidata_id);
};

interface WikiDataAPIResponse {
  success: number;
  search: {
    id: WikidataId;
  }[];
}

async function searchOrganisationWikidataId(
  org_name: string,
): Promise<{ name: string; id: WikidataId }[]> {
  try {
    await umami.log({ event: "/jorfsearch-request-wikidata-names" });

    const wikidataIds_raw: WikidataId[] = await axios
      .get<WikiDataAPIResponse>(
        encodeURI(
          `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${org_name}&language=fr&origin=*&format=json&limit=50`,
        ),
      )
      .then((r) => {
        return r.data.search.map((o) => o.id);
      });
    if (wikidataIds_raw.length == 0) return []; // prevents unecessary jorf event

    return await axios
      .get<
        { name: string; id: WikidataId }[]
      >(encodeURI(`https://jorfsearch.steinertriples.ch/wikidata_id_to_name?ids[]=${wikidataIds_raw.join("&ids[]=")}`))
      .then((r) => r.data);
  } catch (error) {
    console.log(error);
    return [];
  }
}

export const followOrganisationCommand =
  (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
    const chatId = msg.chat.id;
    await umami.log({ event: "/follow-organisation" });
    try {
      await bot.sendChatAction(chatId, "typing");
      const question = await bot.sendMessage(
        chatId,
        `Entrez le nom ou l'identifiant [wikidata](https://www.wikidata.org/wiki/Wikidata:Main_Page) de l'organisation que vous souhaitez suivre:
Exemples:
Conseil d'Etat : *Q769657*
Conseil constitutionnel : *Q1127218*`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            force_reply: true,
          },
        },
      );
      bot.onReplyToMessage(chatId, question.message_id, async (msg) => {
        if (msg.text === undefined || msg.text === "") {
          await bot.sendMessage(
            chatId,
            `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /followOrganisation.`,
          );
          return;
        }

        const orgResults = await searchOrganisationWikidataId(msg.text);

        if (orgResults.length == 0) {
          await bot.sendMessage(
            chatId,
            `Votre recherche n'a donné aucun résultat. 👎 Veuillez essayer de nouveau la commande /followOrganisation.`,
          );
          return;
        }

        if (orgResults.length == 1) {
          const user = await User.firstOrCreate({ tgUser: msg2.from, chatId });
          if (user.followedOrganisations === undefined)
            user.followedOrganisations = [];

          // If the one result is already followed
          if (isOrganisationAlreadyFollowed(user, orgResults[0].id)) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            await bot.sendMessage(
              chatId,
              `Vous suivez déjà *${orgResults[0].name}* ✅`,
              startKeyboard,
            );
            return;
          }
          const followConfirmation = await bot.sendMessage(
            `Un résultat correspondant à votre recherche: *${orgResults[0].name}* - [JORFSearch](https://jorfsearch.steinertriples.ch/${encodeURI(orgResults[0].id)})}\n\n
Voulez-vous ajouter ces personnes à vos contacts ? (répondez *oui* ou *non*)`,
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
                return await bot.sendMessage(
                  chatId,
                  `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /followOrganisation.`,
                );
              }
              if (new RegExp(/oui/i).test(msg.text)) {
                const JORFRes = await callJORFSearchOrganisation(
                  orgResults[0].id,
                );

                const organisation: IOrganisation =
                  await Organisation.firstOrCreate({
                    nom: JORFRes[0].organisations[0].nom,
                    wikidata_id: JORFRes[0].organisations[0].wikidata_id,
                  });
                user.followedOrganisations.push({
                  wikidata_id: organisation.wikidata_id,
                  lastUpdate: new Date(Date.now()),
                });
                await bot.sendMessage(
                  chatId,
                  `Vous suivez maintenant *${orgResults[0].name}* ✅`,
                  startKeyboard,
                );
              }
            },
          );
          // More than one org results
        } else {
          let text =
            "Voici les organisations correspondant à votre recherche :\n\n";
          for (let k = 0; k < orgResults.length; k++) {
            const organisation_k = orgResults[k];
            text += `${String(
              k + 1,
            )}. *${organisation_k.name}* - [JORFSearch](https://jorfsearch.steinertriples.ch/${encodeURI(organisation_k.id)})\n\n`;
          }
          await sendLongText(bot, chatId, text);

          const question = await bot.sendMessage(
            chatId,
            "Entrez le(s) nombre(s) correspondant au(x) organisation(s) à suivre.\nExemple: 1 4 7",
            {
              reply_markup: {
                force_reply: true,
              },
            },
          );

          bot.onReplyToMessage(
            chatId,
            question.message_id,
            async (msg2: TelegramBot.Message) => {
              let answers = parseIntAnswers(msg2.text, orgResults.length);
              if (answers === null || answers.length == 0) {
                await bot.sendMessage(
                  chatId,
                  `Votre réponse n'a pas été reconnue: merci de renseigner une ou plusieurs options entre 1 et ${String(orgResults.length)}.
      👎 Veuillez essayer de nouveau la commande /followOrganisation.`,
                  startKeyboard,
                );
                return;
              }

              await bot.sendChatAction(chatId, "typing");

              const user = await User.firstOrCreate({
                tgUser: msg2.from,
                chatId,
              });
              if (user.followedOrganisations === undefined)
                user.followedOrganisations = [];

              for (const answer of answers) {
                if (answer > orgResults.length) continue; // this shoud not happen

                // Don't call JORF if the organisation is already followed
                if (
                  isOrganisationAlreadyFollowed(user, orgResults[answer - 1].id)
                )
                  continue;

                const JORFRes = await callJORFSearchOrganisation(
                  orgResults[answer - 1].id,
                );

                const organisation: IOrganisation =
                  await Organisation.firstOrCreate({
                    nom: JORFRes[0].organisations[0].nom,
                    wikidata_id: JORFRes[0].organisations[0].wikidata_id,
                  });

                user.followedOrganisations.push({
                  wikidata_id: organisation.wikidata_id,
                  lastUpdate: new Date(Date.now()),
                });
              }

              await user.save();

              await new Promise((resolve) => setTimeout(resolve, 500));
              if (answers.length == 1) {
                await bot.sendMessage(
                  chatId,
                  `Vous suivez l'organisation *${orgResults[0].name}* ✅`,
                  startKeyboard,
                );
              } else {
                await sendLongText(
                  bot,
                  chatId,
                  `Vous suivez les organisations: *${orgResults[0].name}* ✅\n${orgResults
                    .map((org) => `\n   - *${org.name}*`)
                    .join("\n\n")}`,
                );
              }
            },
          );
        }
      });
    } catch (error) {
      console.log(error);
    }
  };
