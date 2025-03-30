import { startKeyboard } from "../utils/keyboards";
import { sendLongText } from "../utils/sendLongText";
import User from "../models/User";
import People from "../models/People";
import umami from "../utils/umami";
import TelegramBot, { ChatId } from "node-telegram-bot-api";
import { getFunctionsFromValues } from "../entities/FunctionTags";
import {IOrganisation, IPeople} from "../types";
import Organisation from "../models/Organisation";

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

function sortArrayAlphabetically(array: string[]) {
  return array.sort((a, b) => {
    return a.localeCompare(b);
  });
}

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
  try {
    const chatId: ChatId = msg.chat.id;

    await umami.log({ event: "/unfollow" });

    await bot.sendChatAction(chatId, "typing");

    const user = await User.firstOrCreate({ tgUser: msg.from, chatId });

    const followedFunctions = sortArrayAlphabetically(
      user.followedFunctions,
    );

    if (user.followedOrganisations === undefined) user.followedOrganisations=[];
    const followedOrganisations: IOrganisation[] = await Organisation.find({
      wikidata_id: {
        $in: user.followedOrganisations.map((o) => o.wikidata_id),
      },
    })
      .collation({ locale: "fr" })
      .sort({ nom: 1 });

    const followedPeoples: IPeople[] = await People.find({
      _id: { $in: user.followedPeople.map((p) => p.peopleId) },
    })
      .collation({ locale: "fr" })
      .sort({ nom: 1 })
      .lean();

    if (
      followedFunctions.length === 0 &&
      followedOrganisations.length === 0 &&
      followedPeoples.length === 0
    ) {
      await bot.sendMessage(
        chatId,
        `Vous ne suivez aucun contact, fonction, ni organisation pour le moment. Cliquez sur *🧩 Ajouter un contact* pour commencer à suivre des contacts.`,
        startKeyboard,
      );
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
        )}. *${organisation_k.nom}* - [JORFSearch](https://jorfsearch.steinertriples.ch/${encodeURI(organisation_k.wikidata_id)})\n\n`;
      }
    }
    let j = 0;
    if (followedPeoples.length > 0) {
      text += "Voici les personnes que vous suivez :\n\n";
      for (; j < followedPeoples.length; j++) {
        const people_j = followedPeoples[j];
        text += `${String(
          i + k + j + 1,
        )}. *${people_j.nom} ${people_j.prenom}* - [JORFSearch](https://jorfsearch.steinertriples.ch/name/${encodeURI(
          `${people_j.prenom} ${people_j.nom}`,
        )})\n\n`;
      }
    }

    await sendLongText(bot, chatId, text);

    const question = await bot.sendMessage(
      chatId,
      "Entrez le(s) nombre(s) correspondant au(x) contact(s) à supprimer.\nExemple: 1 4 7",
      {
        reply_markup: {
          force_reply: true,
        },
      },
    );

    bot.onReplyToMessage(
      chatId,
      question.message_id,
      async (msg: TelegramBot.Message) => {
        const selectionIndexMax =
            followedPeoples.length +
            followedFunctions.length +
            followedOrganisations.length;
        let answers = parseIntAnswers(msg.text, selectionIndexMax);
        if (answers === null) {
          await bot.sendMessage(
            chatId,
            `Votre réponse n'a pas été reconnue: merci de renseigner une ou plusieurs options entre 1 et ${String(selectionIndexMax)}.
👎 Veuillez essayer de nouveau la commande /unfollow.`,
            startKeyboard,
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

        const unfollowedPeople = answers
          .filter((i) => i > followedOrganisations.length)
          .map(
            (i) =>
              followedPeoples[
                i - followedFunctions.length - followedOrganisations.length
              ],
          );

        await user.save();

        let text = "";

        const unfollowedFunctionsKeys =
          getFunctionsFromValues(unfollowedFunctions);

        const unfollowedTotal =
          unfollowedFunctions.length +
          unfollowedOrganisations.length +
          unfollowedPeople.length;

        // If only 1 item unfollowed
        if (unfollowedTotal === 1) {
          if (unfollowedFunctions.length === 1) {
            text += `Vous ne suivez plus la fonction *${
              unfollowedFunctionsKeys[0]
            }* 🙅‍♂️`;
          } else if (unfollowedOrganisations.length === 1) {
            text += `Vous ne suivez plus l'organisation *${unfollowedOrganisations[0].nom}* 🙅‍♂️`;
          } else if (unfollowedPeople.length === 1) {
            text += `Vous ne suivez plus la personne *${unfollowedPeople[0].prenom} ${unfollowedPeople[0].nom}* 🙅‍♂️`;
          }
        } else if (unfollowedTotal === unfollowedFunctions.length) {
          // If only 1 type of unfollowed items
          text +=
            "Vous ne suivez plus les fonctions 🙅‍ :" +
            unfollowedFunctions
              .map((_fct, i) => `\n - *${unfollowedFunctionsKeys[i]}*`)
              .join("");
        } else if (unfollowedTotal === unfollowedOrganisations.length) {
          // If
          text +=
            "Vous ne suivez plus les organisations 🙅‍ :" +
            unfollowedOrganisations.map((org) => `\n - *${org.nom}*`).join("");
        } else if (unfollowedTotal === unfollowedPeople.length) {
          // If
          text +=
            "Vous ne suivez plus les personnes 🙅‍ :" +
            unfollowedPeople.map((p) => `\n - *${p.prenom} ${p.nom}*`).join("");
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
          if (unfollowedPeople.length > 0) {
            if (unfollowedPeople.length === 1) {
              text += `\n- Personne : *${unfollowedPeople[0].prenom} ${unfollowedPeople[0].nom}`;
            } else {
              text +=
                `\n- Personnes :` +
                unfollowedPeople
                  .map((p) => `\n   - *${p.prenom} ${p.nom}*`)
                  .join("");
            }
          }
        }

        user.followedPeople = user.followedPeople.filter(
          (people) =>
            !unfollowedPeople
              .map((p) => p._id.toString())
              .includes(people.peopleId.toString()),
        );

        if (user.followedOrganisations === undefined) user.followedOrganisations=[];
        user.followedOrganisations = user.followedOrganisations.filter(
          (org) =>
            !unfollowedOrganisations
              .map((o) => o.wikidata_id)
              .includes(org.wikidata_id),
        );

        user.followedFunctions = (
          user.followedFunctions
        ).filter((tag) => !unfollowedFunctions.includes(tag));

        await user.save();

        await bot.sendMessage(chatId, text, startKeyboard);
      },
    );
  } catch (error) {
    console.log(error);
  }
};
