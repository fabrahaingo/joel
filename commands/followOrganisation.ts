import umami from "../utils/umami.ts";
import TelegramBot from "node-telegram-bot-api";
import Organisation from "../models/Organisation.ts";
import User from "../models/User.ts";
import { IOrganisation, ISession, IUser, WikidataId } from "../types.ts";
import axios from "axios";
import { parseIntAnswers } from "../utils/text.utils.ts";
import {
  extractTelegramSession,
  TelegramSession
} from "../entities/TelegramSession.ts";
import { getJORFSearchLinkOrganisation } from "../utils/JORFSearch.utils.ts";
import { Keyboard, KEYBOARD_KEYS } from "../entities/Keyboard.ts";

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
    if (org_name.length == 0) return [];

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

export const followOrganisationTelegram = async (session: ISession) => {
  try {
    await session.log({ event: "/follow-organisation" });
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
      tgSession.chatIdTg,
      question.message_id,
      (tgMsg1: TelegramBot.Message) => {
        void (async () => {
          await searchOrganisationFromStr(
            session,
            "SuivreO " + (tgMsg1.text ?? ""),
            false
          );
        })();
      }
    );
  } catch (error) {
    console.log(error);
  }
};

export const searchOrganisationFromStr = async (
  session: ISession,
  msg: string,
  triggerUmami = true
) => {
  try {
    if (triggerUmami) await session.log({ event: "/follow-organisation" });

    const orgName = msg.split(" ").splice(1).join(" ");

    const orgResults = await searchOrganisationWikidataId(orgName);

    const tempKeyboard: Keyboard = [
      [KEYBOARD_KEYS.ORGANISATION_FOLLOW.key],
      [KEYBOARD_KEYS.MAIN_MENU.key]
    ];

    if (orgResults.length == 0) {
      let text = `Votre recherche n'a donné aucun résultat. 👎\nVeuillez essayer de nouveau la commande.`;
      if (session.messageApp === "Telegram") {
        text += `\n\nFormat:\n*Nom de l'organisation*\nou\n*WikidataId de l'organisation*`;
        await session.sendMessage(text, tempKeyboard);
      } else {
        text += `\n\nFormat:\n*RechercherO Nom de l'organisation*\nou\n*RechercherO WikidataId de l'organisation*`;
        await session.sendMessage(text);
      }
      return;
    }

    if (orgResults.length == 1) {
      session.user = await User.findOrCreate(session);

      const orgUrl = getJORFSearchLinkOrganisation(orgResults[0].wikidataId);

      let text = `Une organisation correspond à votre recherche:\n\n*${orgResults[0].nom}* (${orgResults[0].wikidataId})`;
      if (session.messageApp === "Telegram")
        text += ` - [JORFSearch](${orgUrl})\n`;
      else text += `\n${orgUrl}\n`;

      if (
        isOrganisationAlreadyFollowed(session.user, orgResults[0].wikidataId)
      ) {
        text += `\nVous suivez déjà *${orgResults[0].nom} * ✅`;
        if (session.messageApp === "Telegram")
          await session.sendMessage(text, tempKeyboard);
        else await session.sendMessage(text);
        return;
      } else {
        text += `\nPour être notifié de toutes les nominations en rapport avec cette organisation ?\nUtilisez le bouton ci-dessous ou la commande: *SuivreO ${orgResults[0].wikidataId}*`;
        await session.sendMessage(text, [
          [{ text: `SuivreO ${orgResults[0].wikidataId}` }],
          [KEYBOARD_KEYS.MAIN_MENU.key]
        ]);
      }
      // More than one org results
    } else {
      let text =
        "Voici les organisations correspondant à votre recherche :\n\n";
      for (let k = 0; k < orgResults.length; k++) {
        const organisation_k = orgResults[k];
        const orgUrl_k = getJORFSearchLinkOrganisation(
          organisation_k.wikidataId
        );

        text += `${String(
          k + 1
        )}. *${organisation_k.nom}* (${organisation_k.wikidataId})`;

        if (session.messageApp === "Telegram")
          text += `- [JORFSearch](${orgUrl_k})`;

        if (
          session.user != undefined &&
          isOrganisationAlreadyFollowed(session.user, organisation_k.wikidataId)
        )
          text += ` - Suivi ✅`;
        if (session.messageApp !== "Telegram") text += `\n${orgUrl_k}`;

        text += "\n\n";
      }

      if (orgResults.length >= 10)
        text +=
          "Des résultats ont pu être omis en raison de la taille de la liste.\n\n";
      await session.sendMessage(text);

      if (session.messageApp === "Telegram") {
        const tgSession: TelegramSession | undefined =
          await extractTelegramSession(session, false);
        if (tgSession == null) return;
        const tgBot = tgSession.telegramBot;

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
          tgSession.chatIdTg,
          question.message_id,
          (tgMsg3: TelegramBot.Message) => {
            void (async () => {
              const answers = parseIntAnswers(tgMsg3.text, orgResults.length);
              await followOrganisationsFromWikidataIdStr(
                session,
                `SuivreO ${answers.map((k) => orgResults[k - 1].wikidataId).join(" ")}`,
                false
              );
              return;
            })();
          }
        );
      } else {
        await session.sendMessage(
          `Pour suivre une ou plusieurs organisation utilisez la commande avec le(s) WikiDataId correspondant: *SuivreO ${orgResults[0].wikidataId} ${orgResults[1].wikidataId}*`
        );
      }
    }
  } catch (error) {
    console.log(error);
  }
};

export const followOrganisationsFromWikidataIdStr = async (
  session: ISession,
  msg: string,
  triggerUmami = true
) => {
  try {
    if (msg.trim().split(" ").length < 2) {
      await searchOrganisationFromStr(session, msg);
      return;
    }
    if (triggerUmami) await session.log({ event: "/follow-organisation" });
    await session.sendTypingAction();

    const selectedWikiDataIds = msg
      .split(" ")
      .splice(1)
      .map((s) => s.toUpperCase());

    const tempKeyboard: Keyboard = [
      [KEYBOARD_KEYS.ORGANISATION_FOLLOW.key],
      [KEYBOARD_KEYS.MAIN_MENU.key]
    ];

    if (selectedWikiDataIds.length == 0) {
      const text = `Votre recherche n'a donné aucun résultat 👎.\nVeuillez essayer de nouveau la commande.`;
      await session.sendMessage(
        text,
        session.messageApp !== "WhatsApp" ? tempKeyboard : undefined
      );
      return;
    }

    const parameterString = selectedWikiDataIds.join(" ");
    // if the id don't contain any number, it's an organisation name
    if (!/\d/.test(parameterString)) {
      await searchOrganisationFromStr(
        session,
        "RechercherO " + parameterString
      );
      return;
    }

    const orgResults: IOrganisation[] = [];

    const orgsInDb: IOrganisation[] = await Organisation.find({
      wikidataId: { $in: selectedWikiDataIds }
    }).lean();
    for (const id of selectedWikiDataIds) {
      const orgFromDb: IOrganisation | undefined = orgsInDb.find(
        (o) => o.wikidataId === id
      );
      if (orgFromDb != undefined) {
        orgResults.push(orgFromDb);
      } else {
        const orgInfoFromJORF = await searchOrganisationWikidataId(id);
        if (orgInfoFromJORF.length > 0) {
          const newOrg: IOrganisation = await Organisation.findOrCreate({
            nom: orgInfoFromJORF[0].nom,
            wikidataId: orgInfoFromJORF[0].wikidataId
          });
          orgResults.push(newOrg);
        }
      }
    }

    if (orgResults.length == 0) {
      let msg = "";
      if (selectedWikiDataIds.length > 1)
        msg += "Les ids fournis n'ont pas été reconnus. 👎";
      else msg += "L'id fourni n'a pas été reconnu. 👎";
      msg += "\nVeuillez essayer de nouveau la commande.";

      await session.sendMessage(
        msg,
        session.messageApp !== "WhatsApp" ? tempKeyboard : undefined
      );
      return;
    }

    session.user ??= await User.findOrCreate(session);

    for (const org of orgResults) {
      // Don't call JORF if the organisation is already followed
      if (!isOrganisationAlreadyFollowed(session.user, org.wikidataId))
        session.user.followedOrganisations.push({
          wikidataId: org.wikidataId,
          lastUpdate: new Date()
        });
    }

    await session.user.save();

    let text = "";

    if (orgResults.length == 1)
      text += `Vous suivez désormais *${orgResults[0].nom}* (${orgResults[0].wikidataId}) ✅`;
    else
      text += `Vous suivez désormais les organisations: ✅\n${orgResults
        .map((org) => `\n   - *${org.nom}* (${org.wikidataId})`)
        .join("\n")}`;

    if (session.messageApp === "Telegram")
      await session.sendMessage(text, tempKeyboard);
    else await session.sendMessage(text);
  } catch (error) {
    console.log(error);
  }
};
