import User from "../models/User.js";
import People from "../models/People.js";
import TelegramBot from "node-telegram-bot-api";
import { FunctionTags, getFunctionsFromValues } from "../entities/FunctionTags.js";
import { IOrganisation, IPeople, ISession } from "../types.js";
import Organisation from "../models/Organisation.js";
import { Types } from "mongoose";
import { mainMenuKeyboard } from "../utils/keyboards.js";
import { extractTelegramSession, TelegramSession } from "../entities/TelegramSession.js";
import { parseIntAnswers } from "../utils/text.utils.js";

function sortFunctionsAlphabetically(array: FunctionTags[]) {
  return array.sort((a, b) => {
    return a.localeCompare(b);
  });
}

export const unfollowCommand = async (session: ISession, _msg: never) => {
  try {
    await session.log({ event: "/unfollow" });

    await session.sendTypingAction();

    const noDataText=
        `Vous ne suivez aucun contact, fonction, ni organisation pour le moment. Cliquez sur *🧩 Ajouter un contact* pour commencer à suivre des contacts.`;

    // We only want to create a user upon use of the follow function
    if (session.user == null) {
      await session.sendMessage(noDataText, mainMenuKeyboard);
      return;
    }

    const tgSession: TelegramSession | undefined = await extractTelegramSession(session, true);
    if (tgSession == null) return;

    const tgBot = tgSession.telegramBot;

    const followedFunctions = sortFunctionsAlphabetically(
      session.user.followedFunctions,
    );

    if (session.user.followedOrganisations === undefined) session.user.followedOrganisations=[];
    const followedOrganisations: IOrganisation[] = await Organisation.find({
      wikidataId: {
        $in: session.user.followedOrganisations.map((o) => o.wikidataId),
      },
    })
      .collation({ locale: "fr" })
      .sort({ nom: 1 });

    const followedPeoples: IPeople[] = await People.find({
      _id: { $in: session.user.followedPeople.map((p) => p.peopleId) },
    })
      .collation({ locale: "fr" })
      .lean();

    if (session.user.followedNames === undefined) session.user.followedNames = [];
    const followedPeopleTab: {
      nomPrenom: string,
      peopleId?: Types.ObjectId,
      JORFSearchLink?: string,
    }[] = [];
      session.user.followedNames.forEach(p=> followedPeopleTab.push({nomPrenom: p}));
    followedPeoples.forEach(p=>followedPeopleTab.push({
      nomPrenom: `${p.nom} ${p.prenom}`,
      peopleId: p._id,
      JORFSearchLink: encodeURI(`https://jorfsearch.steinertriples.ch/name/${p.prenom} ${p.nom}`),
    }));
      followedPeopleTab.sort((a, b) => {
      if (a.nomPrenom.toUpperCase() < b.nomPrenom.toUpperCase()) return -1;
      if (a.nomPrenom.toUpperCase() > b.nomPrenom.toUpperCase()) return 1;
      return 0;
    });

    if (
      followedFunctions.length === 0 &&
      followedOrganisations.length === 0 &&
      followedPeopleTab.length === 0
    ) {
      await session.sendMessage(noDataText, mainMenuKeyboard);
      return;
    }
    let text = "";
    let i = 0;
    if (followedFunctions.length > 0) {
      const followedFunctionsKeys = getFunctionsFromValues(followedFunctions);
      text += "Voici les fonctions que vous suivez :\n\n";
      for (; i < followedFunctions.length; i++) {
        const function_i = followedFunctions[i - 1];
        text += `${String(
          i + 1,
        )}. *${String(followedFunctionsKeys[i])}* - [JORFSearch](https://jorfsearch.steinertriples.ch/tag/${encodeURI(
          function_i,
        )})\n\n`;
      }
    }
    let k = 0;
    if (followedOrganisations.length > 0) {
      text += "Voici les organisations que vous suivez :\n\n";
      for (; k < followedOrganisations.length; k++) {
        const organisation_k = followedOrganisations[k];
        text += `${String(
          i + k + 1,
        )}. *${organisation_k.nom}* - [JORFSearch](https://jorfsearch.steinertriples.ch/${encodeURI(organisation_k.wikidataId)})\n\n`;
      }
    }
    let j = 0;
    if (followedPeopleTab.length > 0) {
      text += "Voici les personnes que vous suivez :\n\n";
      for (; j < followedPeopleTab.length; j++) {
          const followedName= followedPeopleTab[j];
          text += `${String(
          i + k + j + 1,
        )}. *${followedName.nomPrenom}* - `;
        if (followedName.JORFSearchLink !== undefined) {
          text += `[JORFSearch](${followedName.JORFSearchLink})\n\n`;
        } else {
          text += `Suivi manuel\n\n`;
        }
      }
    }

    await session.sendMessage(text);

    const question = await tgBot.sendMessage(
      session.chatId,
      "Entrez le(s) nombre(s) correspondant au(x) contact(s) à supprimer.\nExemple: 1 4 7",
      {
        reply_markup: {
          force_reply: true,
        },
      },
    );

    tgBot.onReplyToMessage(
      session.chatId,
      question.message_id,
      async (msg: TelegramBot.Message) => {
        const maxAllowedValue =
            followedPeopleTab.length +
            followedFunctions.length +
            followedOrganisations.length;
        let answers = parseIntAnswers(msg.text, maxAllowedValue);
        if (answers === null) {
          await session.sendMessage(
            `Votre réponse n'a pas été reconnue: merci de renseigner une ou plusieurs options entre 1 et ${String(maxAllowedValue)}.
👎 Veuillez essayer de nouveau la commande /unfollow.`,
            mainMenuKeyboard,
          );
          return;
        }

        // Shift all answers by 1 to get array-wise indexes
        answers = answers.map((i) => i - 1);

        const unfollowedFunctions = answers
          .filter((i) => i < followedFunctions.length)
          .map((i) => followedFunctions[i]);

        const unfollowedOrganisations = answers
          .filter(
            (i) =>
              i >= followedFunctions.length && i < followedOrganisations.length,
          )
          .map((i) => followedOrganisations[i - followedFunctions.length]);

        const unfollowedPeopleIdx = answers
          .filter((i) => i >= followedFunctions.length + followedOrganisations.length)
          .map(i=> i - followedFunctions.length - followedOrganisations.length);

        const unfollowedPrenomNomTab: string[] = [];

        const unfollowedPeopleId = unfollowedPeopleIdx.reduce(
          (tab: Types.ObjectId[], idx) => {
              if (followedPeopleTab[idx].peopleId === undefined) return tab;
              const unfollowPerson: IPeople | undefined = followedPeoples
                  .find(p=> p._id.toString() === followedPeopleTab[idx].peopleId.toString());
              if (unfollowPerson == undefined) return tab;
              tab.push(unfollowPerson._id);
              unfollowedPrenomNomTab.push(`${unfollowPerson.prenom} ${unfollowPerson.nom}`);
              return tab;
          }, []
        );

        const unfollowedNamesIdx= unfollowedPeopleIdx.reduce(
          (tab: number[], idx) => {
              if (followedPeopleTab[idx].peopleId !== undefined) return tab;
              const idInFollowedNameTab = session.user.followedNames.findIndex(name=> name === followedPeopleTab[idx].nomPrenom);
              if (idInFollowedNameTab == -1) return tab;
              tab.push(idInFollowedNameTab);
              const nameTab= session.user.followedNames[idInFollowedNameTab].split(' ');
              unfollowedPrenomNomTab.push(`${nameTab[nameTab.length-1]} ${nameTab.slice(0,nameTab.length-1).join(' ')}`);
              return tab;
          }, []
        );

        let text = "";

        const unfollowedFunctionsKeys =
          getFunctionsFromValues(unfollowedFunctions);

        const unfollowedTotal =
          unfollowedFunctions.length +
          unfollowedOrganisations.length +
          unfollowedPeopleIdx.length;

        // If only 1 item unfollowed
        if (unfollowedTotal === 1) {
          if (unfollowedFunctions.length === 1) {
            text += `Vous ne suivez plus la fonction *${
              unfollowedFunctionsKeys[0]
            }* 🙅‍♂️`;
          } else if (unfollowedOrganisations.length === 1) {
            text += `Vous ne suivez plus l'organisation *${unfollowedOrganisations[0].nom}* 🙅‍♂️`;
          } else if (unfollowedPrenomNomTab.length === 1) {
            text += `Vous ne suivez plus la personne *${unfollowedPrenomNomTab[0]}* 🙅‍♂️`;
          }
        } else if (unfollowedTotal === unfollowedFunctions.length) {
        // If only 1 type of unfollowed items: functions
          text +=
            "Vous ne suivez plus les fonctions 🙅‍ :" +
            unfollowedFunctions
              .map((_fct, i) => `\n - *${unfollowedFunctionsKeys[i]}*`)
              .join("");
        } else if (unfollowedTotal === unfollowedOrganisations.length) {
        // If only 1 type of unfollowed items: organisations
          text +=
            "Vous ne suivez plus les organisations 🙅‍ :" +
            unfollowedOrganisations.map((org) => `\n - *${org.nom}*`).join("");
        } else if (unfollowedTotal === unfollowedPrenomNomTab.length) {
        // If only 1 type of unfollowed items: people
          text +=
            "Vous ne suivez plus les personnes 🙅‍ :" +
              unfollowedPrenomNomTab.map((p) => `\n - *${p}*`).join("");
        } else {
          // Mixed types of unfollowed items
          text += "Vous ne suivez plus les items 🙅‍ :";
          if (unfollowedFunctions.length > 0) {
            if (unfollowedFunctions.length === 1) {
              text += `\n- Fonction : *${unfollowedFunctionsKeys[0]}*`;
            } else {
              text +=
                `\n- Fonctions :` +
                unfollowedFunctions
                  .map((_fct, i) => `\n   - *${unfollowedFunctionsKeys[i]}*`)
                  .join("");
            }
          }
          if (unfollowedOrganisations.length > 0) {
            if (unfollowedOrganisations.length === 1) {
              text += `\n- Organisation : *${unfollowedOrganisations[0].nom}*`;
            } else {
              text +=
                `\n- Organisations :` +
                unfollowedOrganisations
                  .map((org) => `\n   - *${org.nom}*`)
                  .join("");
            }
          }
          if (followedPeopleTab.length > 0) {
            if (followedPeopleTab.length === 1) {
              text += `\n- Personne : *${unfollowedPrenomNomTab[0]}`;
            } else {
              text +=
                `\n- Personnes :` +
                  unfollowedPrenomNomTab
                  .map((p) => `\n   - *${p}*`)
                  .join("");
            }
          }
        }

          session.user.followedPeople = session.user.followedPeople.filter(
          (people) =>
            !unfollowedPeopleId
              .map((id) => id.toString())
              .includes(people.peopleId.toString()),
        );

          session.user.followedNames = session.user.followedNames.filter(
          (_value, idx) => !unfollowedNamesIdx.includes(idx)
        );

          session.user.followedOrganisations = session.user.followedOrganisations.filter(
          (org) =>
            !unfollowedOrganisations
              .map((o) => o.wikidataId)
              .includes(org.wikidataId),
        );

        session.user.followedFunctions = (
            session.user.followedFunctions
            ).filter((tag) => !unfollowedFunctions.includes(tag));

        await session.user.save();

        await session.sendMessage(text, mainMenuKeyboard);
      },
    );

      // Delete the user if it doesn't follow anything anymore
      if (session.user.followsNothing()) {
          await User.deleteOne({ _id: session.chatId });
          await session.log({ event: "/user-deletion-no-follow" });
      }
  } catch (error) {
    console.log(error);
  }
};
