import { startKeyboard } from "../utils/keyboards";
import { formatSearchResult } from "../utils/formatSearchResult";
import People from "../models/People";
import User from "../models/User";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";
import { Types } from "mongoose";
import { IPeople } from "../types";
import { callJORFSearchPeople } from "../utils/JORFSearch.utils";

const isPersonAlreadyFollowed = (
  person: IPeople,
  followedPeople: { peopleId: Types.ObjectId; lastUpdate: Date }[]
) => {
  return followedPeople.some((followedPerson) => {
    return followedPerson.peopleId.toString() === person._id.toString();
  });
};

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
  const chatId = msg.chat.id;
  await umami.log({ event: "/follow" });
  try {
    await bot.sendChatAction(chatId, "typing");
    const question = await bot.sendMessage(
      chatId,
      "Entrez le prénom et nom de la personne que vous souhaitez suivre:",
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
            `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /follow.`,
            startKeyboard
        );
        return;
      }
      const JORFRes_data = await callJORFSearchPeople(msg.text);

      if (JORFRes_data.length === 0) {
        await bot.sendMessage(
          chatId,
          "Personne introuvable, assurez vous d'avoir bien tapé le prénom et le nom correctement",
          startKeyboard
        );
        return;
      }
      const formattedData = formatSearchResult(JORFRes_data.slice(0, 2), {
        isConfirmation: true,
      });
      const people = await People.firstOrCreate({
        nom: JORFRes_data[0].nom,
        prenom: JORFRes_data[0].prenom,
        sexe: JORFRes_data[0].sexe,
        lastKnownPosition: JORFRes_data[0],
      });
      await people.save();
      const tgUser: TelegramBot.User | undefined = msg.from;
      let user = await User.firstOrCreate({
        tgUser,
        chatId,
      });

      await bot.sendMessage(chatId, `${formattedData}`, startKeyboard);

      if (!isPersonAlreadyFollowed(people, user.followedPeople)) {
        user.followedPeople.push({
          peopleId: people._id,
          lastUpdate: new Date(Date.now()),
        });
        await user.save();
        await new Promise((resolve) => setTimeout(resolve, 500));
        await bot.sendMessage(
            chatId,
            `Vous suivez maintenant *${JORFRes_data[0].prenom} ${JORFRes_data[0].nom}* ✅`,
            startKeyboard
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await bot.sendMessage(
            chatId,
            `Vous suivez déjà *${JORFRes_data[0].prenom} ${JORFRes_data[0].nom}* ✅`,
            startKeyboard
        );
      }
    });
  } catch (error) {
    console.log(error);
  }
};
