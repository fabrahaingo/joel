import umami from "../utils/umami.js";
import TelegramBot from "node-telegram-bot-api";
import Organisation from "../models/Organisation.js";
import User from "../models/User.js";
import { IOrganisation, ISession, IUser, WikidataId } from "../types.js";
import axios from "axios";
import { parseIntAnswers } from "../utils/text.utils.js";
import { mainMenuKeyboard } from "../utils/keyboards.js";
import {
  extractTelegramSession,
  TelegramSession
} from "../entities/TelegramSession.js";

const isOrganisationAlreadyFollowed = (
  user: IUser,
  wikidataId: WikidataId
): boolean => {
  return user.followedOrganisations.some((o) => o.wikidataId === wikidataId);
};

interface WikiDataAPIResponse {
  success: number;
  search: {
    id: WikidataId;
  }[];
}

async function searchOrganisationWikidataId(
  org_name: string
): Promise<{ nom: string; wikidataId: WikidataId }[]> {
  try {
    await umami.log({ event: "/jorfsearch-request-wikidata-names" });

    const wikidataIds_raw: WikidataId[] = await axios
      .get<WikiDataAPIResponse>(
        encodeURI(
          `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${org_name}&language=fr&origin=*&format=json&limit=50`
        )
      )
      .then((r) => {
        return r.data.search.map((o) => o.id);
      });
    if (wikidataIds_raw.length == 0) return []; // prevents unnecessary jorf event

    return (
      await axios
        .get<
          { name: string; id: WikidataId }[]
        >(encodeURI(`https://jorfsearch.steinertriples.ch/wikidata_id_to_name?ids[]=${wikidataIds_raw.join("&ids[]=")}`))
        .then((r) => r.data)
    ).map((o) => ({
      nom: o.name,
      wikidataId: o.id
    }));
  } catch (error) {
    console.log(error);
    return [];
  }
}

export const followOrganisationCommand = async (session: ISession) => {
  await session.log({ event: "/follow-organisation" });
  try {
    if (session.user == null) {
      await session.sendMessage(
        `Aucun profil utilisateur n'est actuellement associé à votre identifiant ${String(session.chatId)}`,
        mainMenuKeyboard
      );
      return;
    }

    const tgSession: TelegramSession | undefined = await extractTelegramSession(
      session,
      true
    );
    if (tgSession == null) return;

    const tgBot = tgSession.telegramBot;

    await session.sendTypingAction();
    const question: TelegramBot.Message = await tgBot.sendMessage(
      session.chatId,
      `Entrez le *nom* ou l'*identifiant* [Wikidata](https://www.wikidata.org/wiki/Wikidata:Main_Page) de l'organisation que vous souhaitez suivre:
Exemples:
*Conseil d'État* ou *Q769657*
*Conseil constitutionnel* ou *Q1127218*`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          force_reply: true
        }
      }
    );
    tgBot.onReplyToMessage(
      session.chatId,
      question.message_id,
      (tgMsg1: TelegramBot.Message) => {
        void (async () => {
          if (tgMsg1.text === undefined || tgMsg1.text === "") {
            await session.sendMessage(
              `Votre réponse n'a pas été reconnue.\n👎 Veuillez essayer de nouveau la commande /followOrganisation.`,
              mainMenuKeyboard
            );
            return;
          }

          const orgResults = await searchOrganisationWikidataId(tgMsg1.text);

          if (orgResults.length == 0) {
            await session.sendMessage(
              `Votre recherche n'a donné aucun résultat.\n👎 Veuillez essayer de nouveau la commande /followOrganisation.`,
              mainMenuKeyboard
            );
            return;
          }

          if (orgResults.length == 1) {
            session.user = await User.findOrCreate(session);

            // If the one result is already followed
            if (
              isOrganisationAlreadyFollowed(
                session.user,
                orgResults[0].wikidataId
              )
            ) {
              await new Promise((resolve) => setTimeout(resolve, 500));
              await session.sendMessage(
                `Vous suivez déjà l'organisation *${orgResults[0].nom}* ✅`,
                mainMenuKeyboard
              );
              return;
            }
            const followConfirmation = await tgBot.sendMessage(
              session.chatId,
              `Une organisation correspond à votre recherche:\n\n*${orgResults[0].nom}* - [JORFSearch](https://jorfsearch.steinertriples.ch/${encodeURI(orgResults[0].wikidataId)})\n
Voulez-vous être notifié de toutes les nominations en rapport avec cette organisation ? (répondez *oui* ou *non*)`,
              {
                parse_mode: "Markdown",
                reply_markup: {
                  force_reply: true
                }
              }
            );
            tgBot.onReplyToMessage(
              session.chatId,
              followConfirmation.message_id,
              (tgMsg2: TelegramBot.Message) => {
                void (async () => {
                  if (session.user == null) return;
                  if (tgMsg2.text !== undefined) {
                    if (new RegExp(/oui/i).test(tgMsg2.text)) {
                      const organisation: IOrganisation =
                        await Organisation.firstOrCreate({
                          nom: orgResults[0].nom,
                          wikidataId: orgResults[0].wikidataId
                        });
                      session.user.followedOrganisations.push({
                        wikidataId: organisation.wikidataId,
                        lastUpdate: new Date()
                      });
                      await session.user.save();
                      await session.sendMessage(
                        `Vous suivez maintenant l'organisation *${orgResults[0].nom}* ✅`,
                        mainMenuKeyboard
                      );
                      return;
                    } else if (new RegExp(/non/i).test(tgMsg2.text)) {
                      await session.sendMessage(
                        `L'organisation *${orgResults[0].nom}* n'a pas été ajoutée aux suivis.`,
                        mainMenuKeyboard
                      );
                      return;
                    }
                  }
                  // If msg.txt undefined or not "oui"/"non"
                  await session.sendMessage(
                    `Votre réponse n'a pas été reconnue.\n👎 Veuillez essayer de nouveau la commande /followOrganisation.`,
                    mainMenuKeyboard
                  );
                  return;
                })();
              }
            );
            // More than one org results
          } else {
            let text =
              "Voici les organisations correspondant à votre recherche :\n\n";
            for (let k = 0; k < orgResults.length; k++) {
              const organisation_k = orgResults[k];
              text += `${String(
                k + 1
              )}. *${organisation_k.nom}* - [JORFSearch](https://jorfsearch.steinertriples.ch/${encodeURI(organisation_k.wikidataId)})\n\n`;
            }
            await session.sendMessage(text);

            const question = await tgBot.sendMessage(
              session.chatId,
              "Entrez le(s) nombre(s) correspondant au(x) organisation(s) à suivre.\nExemple: 1 4 7",
              {
                reply_markup: {
                  force_reply: true
                }
              }
            );

            tgBot.onReplyToMessage(
              session.chatId,
              question.message_id,
              (tgMsg3: TelegramBot.Message) => {
                void (async () => {
                  const answers = parseIntAnswers(
                    tgMsg3.text,
                    orgResults.length
                  );
                  if (answers === null || answers.length == 0) {
                    await session.sendMessage(
                      `Votre réponse n'a pas été reconnue: merci de renseigner une ou plusieurs options entre 1 et ${String(orgResults.length)}.\n👎 Veuillez essayer de nouveau la commande /followOrganisation.`,
                      mainMenuKeyboard
                    );
                    return;
                  }

                  await session.sendTypingAction();

                  const user = await User.findOrCreate(session);

                  for (const answer of answers) {
                    // Don't call JORF if the organisation is already followed
                    if (
                      isOrganisationAlreadyFollowed(
                        user,
                        orgResults[answer - 1].wikidataId
                      )
                    )
                      continue;

                    const organisation: IOrganisation =
                      await Organisation.firstOrCreate({
                        nom: orgResults[answer - 1].nom,
                        wikidataId: orgResults[answer - 1].wikidataId
                      });

                    user.followedOrganisations.push({
                      wikidataId: organisation.wikidataId,
                      lastUpdate: new Date()
                    });
                  }

                  await user.save();

                  await new Promise((resolve) => setTimeout(resolve, 500));
                  await session.sendMessage(
                    `Vous suivez les organisations: ✅\n${orgResults
                      .map((org) => `\n   - *${org.nom}*`)
                      .join("\n")}`,
                    mainMenuKeyboard
                  );
                })();
              }
            );
          }
        })();
      }
    );
  } catch (error) {
    console.log(error);
  }
};
