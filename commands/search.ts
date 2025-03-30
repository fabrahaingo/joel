import { startKeyboard } from "../utils/keyboards";
import { formatSearchResult } from "../utils/formatSearchResult";
import { sendLongText } from "../utils/sendLongText";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";
import { callJORFSearchPeople } from "../utils/JORFSearch.utils";
import { IPeople, IUser } from "../types";
import {Types} from "mongoose";
import User from "../models/User";
import People from "../models/People";

const isPersonAlreadyFollowed = (
    person: IPeople,
    followedPeople: { peopleId: Types.ObjectId; lastUpdate: Date }[]
) => {
  return followedPeople.some((followedPerson) => {
    return followedPerson.peopleId.toString() === person._id.toString();
  });
};

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
  try {
    const chatId = msg.chat.id;

    await umami.log({ event: "/search" });

    await bot.sendChatAction(chatId, "typing");
    const question = await bot.sendMessage(
      chatId,
      "De quelle personne souhaitez-vous voir l'historique des nominations ?",
      {
        reply_markup: {
          force_reply: true,
        },
      }
    );
    bot.onReplyToMessage(chatId, question.message_id, async (msg) => {
      if (msg.text === undefined) {
        await bot.sendMessage(
            chatId,
            `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /search.`,
            startKeyboard
        );
        return;
      }

      const JORFRes_data = await callJORFSearchPeople(msg.text);
      const formattedData = formatSearchResult(JORFRes_data);

      // Check if the user has an account and follows the person
      const tgUser: TelegramBot.User | undefined = msg.from;
      const user: IUser | null = await User.findOne({ chatId });

      const keyboard_new_search_and_follow = [
        [{text: `Suivre ${JORFRes_data[0].prenom} ${JORFRes_data[0].nom}`}],
        [{ text: "🏠 Menu principal" }, { text: "🔎 Nouvelle recherche" }]
      ];

      if (user === null) {
        await sendLongText(bot, chatId, formattedData, keyboard_new_search_and_follow);
        return;
      }

      const people: IPeople = await People.findOne({
        nom: JORFRes_data[0].nom,
        prenom: JORFRes_data[0].prenom,
      });

      if (people === null || !isPersonAlreadyFollowed(people, user.followedPeople)) {
        await sendLongText(bot, chatId, formattedData, keyboard_new_search_and_follow);
        return;
      }

      const keyboard_new_search_no_follow = [
        [{ text: "🔎 Nouvelle recherche" }],
        [{ text: "🏠 Menu principal" }]
      ];

      await sendLongText(bot, chatId, formattedData, keyboard_new_search_no_follow);
    });
  } catch (error) {
    console.log(error);
  }
};
