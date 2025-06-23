import { customKeyboard, startKeyboard } from "../utils/keyboards";
import { formatSearchResult } from "../utils/formatSearchResult";
import { sendLongText } from "../utils/sendLongText";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";
import { callJORFSearchPeople } from "../utils/JORFSearch.utils";
import { IPeople, IUser } from "../types";
import { Types } from "mongoose";
import User from "../models/User";
import People from "../models/People";

const isPersonAlreadyFollowed = (
  person: IPeople,
  followedPeople: { peopleId: Types.ObjectId; lastUpdate: Date }[],
) => {
  return followedPeople.some((followedPerson) => {
    return followedPerson.peopleId.toString() === person._id.toString();
  });
};

export const searchCommand =
  (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
    await umami.log({ event: "/search" });

    const tgUser = msg.from;
    if (!tgUser) return;
    const chatId = msg.chat.id;

    await bot.sendChatAction(chatId, "typing");
    const question = await bot.sendMessage(
      chatId,
      "Entrez le prénom et nom de la personne que vous souhaitez rechercher:",
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
        if (msg.text === undefined) {
          await bot.sendMessage(
            chatId,
            `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /search.`,
            startKeyboard,
          );
          return;
        }
        await searchPersonHistory(bot, chatId, msg.text, "latest");
      },
    );
  };

export const fullHistoryCommand =
  (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
    await umami.log({ event: "/history" });

    const person = msg.text?.split(" ").slice(2).join(" ");

    if (person === undefined || person.length == 0) {
      await bot.sendMessage(
        msg.from.id,
        "Saisie incorrecte. Veuillez réessayer.",
          customKeyboard([
              [{ text: "🔎 Nouvelle recherche" }],
              [{ text: "🏠 Menu principal" }],
          ]),
      );
      return;
    }
    await searchPersonHistory(bot, msg.from.id, person, "full");
  };

async function searchPersonHistory(
  bot: TelegramBot,
  chatId: TelegramBot.ChatId,
  personName: string,
  historyType: "full" | "latest",
) {
  try {
    const JORFRes_data = await callJORFSearchPeople(personName);
    const nbRecords = JORFRes_data.length;

    if (nbRecords == 0) {
      await bot.sendMessage(
        chatId,
        "Personne introuvable, assurez vous d'avoir bien tapé le prénom et le nom correctement",
          customKeyboard([
              [{ text: "🔎 Nouvelle recherche" }],
              [{ text: "🏠 Menu principal" }],
          ]),
      );
      return;
    }

    let text = "";
    if (historyType === "latest") {
      text += formatSearchResult(JORFRes_data.slice(0, 2), {
        isConfirmation: true,
      });
    } else {
      text += formatSearchResult(JORFRes_data);
    }

    // Check if the user has an account and follows the person
    const user: IUser | null = await User.findOne({ chatId });

    let isUserFollowingPerson: boolean | null;
    if (user === null) {
      isUserFollowingPerson = false;
    } else {
      const people: IPeople = await People.findOne({
        nom: JORFRes_data[0].nom,
        prenom: JORFRes_data[0].prenom,
      });
      isUserFollowingPerson = !(
        people === null || !isPersonAlreadyFollowed(people, user.followedPeople)
      );
    }

    let temp_keyboard: { text: string }[][] | null;
    if (nbRecords <= 2 && isUserFollowingPerson) {
      temp_keyboard = [
        [{ text: "🔎 Nouvelle recherche" }],
        [{ text: "🏠 Menu principal" }],
      ];
    } else {
      temp_keyboard = [
        [{ text: "🏠 Menu principal" }, { text: "🔎 Nouvelle recherche" }],
      ];
      if (historyType === "latest" && nbRecords > 2) {
        text += `${String(nbRecords - 2)} autres mentions au JORF non affichées.\n\n`;
        temp_keyboard.unshift([
          {
            text: `Historique de ${JORFRes_data[0].prenom} ${JORFRes_data[0].nom}`,
          },
        ]);
      }
      if (!isUserFollowingPerson) {
        temp_keyboard.unshift([
          {
            text: `Suivre ${JORFRes_data[0].prenom} ${JORFRes_data[0].nom}`,
          },
        ]);
      }
    }

    if (isUserFollowingPerson) {
      text += `Vous suivez *${JORFRes_data[0].prenom} ${JORFRes_data[0].nom}* ✅`;
    } else {
      text += `Vous ne suivez pas *${JORFRes_data[0].prenom} ${JORFRes_data[0].nom}* 🙅‍♂️`;
    }
    await sendLongText(bot, chatId, text, customKeyboard(temp_keyboard));
  } catch (error) {
    console.log(error);
  }
}

export const followCommand =
  (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
    const chatId = msg.chat.id;
    await umami.log({ event: "/follow" });

    const person = msg.text?.split(" ").slice(1).join(" ");

    if (person === undefined || person.length == 0) {
      await bot.sendMessage(
        chatId,
        "Saisie incorrecte. Veuillez réessayer.",
        startKeyboard,
      );
      return;
    }

    try {
      await bot.sendChatAction(chatId, "typing");

      const user = await User.firstOrCreate({
        tgUser: msg.from,
        chatId,
        messageApp: "Telegram"
      });
      if (user === null) return;

      const JORFRes = await callJORFSearchPeople(person);
      if (JORFRes.length == 0) {
        await bot.sendMessage(
          chatId,
          "Personne introuvable, assurez vous d'avoir bien tapé le nom et le prénom correctement",
          startKeyboard,
        );
        return;
      }

      const people = await People.firstOrCreate({
        nom: JORFRes[0].nom,
        prenom: JORFRes[0].prenom,
        lastKnownPosition: JORFRes[0],
      });
      await people.save();

      if (!isPersonAlreadyFollowed(people, user.followedPeople)) {
        user.followedPeople.push({
          peopleId: people._id,
          lastUpdate: new Date(Date.now()),
        });
        await user.save();
        await new Promise((resolve) => setTimeout(resolve, 500));
        await bot.sendMessage(
          chatId,
          `Vous suivez maintenant *${JORFRes[0].prenom} ${JORFRes[0].nom}* ✅`,
          customKeyboard([
            [{ text: "🔎 Nouvelle recherche" }],
            [{ text: "🏠 Menu principal" }],
          ]),
        );
      } else {
        // With the search/follow flow this would happen only if the user types the "Suivre **" manually
        await new Promise((resolve) => setTimeout(resolve, 500));
        await bot.sendMessage(
          chatId,
          `Vous suivez déjà *${JORFRes[0].prenom} ${JORFRes[0].nom}* ✅`,
          customKeyboard([
            [{ text: "🔎 Nouvelle recherche" }],
            [{ text: "🏠 Menu principal" }],
          ]),
        );
      }
    } catch (error) {
      console.log(error);
    }
  };
