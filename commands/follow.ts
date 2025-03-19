import { startKeyboard } from "../utils/keyboards";
import { formatSearchResult } from "../utils/formatSearchResult";
import People from "../models/People";
import User from "../models/User";
import get from "axios";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";
import { Types } from "mongoose";
import { IUser } from "../types";

export function isPersonAlreadyFollowed(
  id: Types.ObjectId,
  followedPeople: IUser["followedPeople"],
): boolean {
  return followedPeople.some((person) => person.peopleId.equals(id));
}

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
      },
    );
    bot.onReplyToMessage(chatId, question.message_id, async (msg) => {
      const JORFRes = await get(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/name/${msg.text}?format=JSON`,
        ),
      ).then(async (res) => {
        if (res.data?.length === 0) {
          return res;
        }
        if (res.request.res.responseUrl) {
          return await get(
            res.request.res.responseUrl.endsWith("?format=JSON")
              ? res.request.res.responseUrl
              : `${res.request.res.responseUrl}?format=JSON`,
          );
        }
      });

      if (
        JORFRes?.data?.length === 0 ||
        !JORFRes?.data[0]?.nom ||
        !JORFRes.data[0]?.prenom
      ) {
        await bot.sendMessage(
          chatId,
          "Personne introuvable, assurez vous d'avoir bien tapé le nom et le prénom correctement",
          startKeyboard,
        );
      } else {
        const formattedData = formatSearchResult(JORFRes.data.slice(0, 2), {
          isConfirmation: true,
        });
        if (!formattedData) {
          await bot.sendMessage(
            chatId,
            "Personne introuvable, assurez vous d'avoir bien tapé le nom et le prénom correctement",
            startKeyboard,
          );
          return;
        }
        const people = await People.firstOrCreate({
          nom: JORFRes.data[0].nom,
          prenom: JORFRes.data[0].prenom,
          lastKnownPosition: JORFRes.data[0],
        });
        await people.save();
        const tgUser: TelegramBot.User | undefined = msg.from;
        const user = await User.firstOrCreate({
          tgUser,
          chatId,
        });

        await bot.sendMessage(chatId, formattedData, startKeyboard);

        if (!isPersonAlreadyFollowed(people._id, user.followedPeople)) {
          user.followedPeople.push({
            peopleId: people._id,
            lastUpdate: new Date(Date.now()),
          });
          await user.save();
          await new Promise((resolve) => setTimeout(resolve, 500));
          await bot.sendMessage(
            chatId,
            `Vous suivez maintenant *${JORFRes.data[0].prenom} ${JORFRes.data[0].nom}* ✅`,
            startKeyboard,
          );
        } else {
          await new Promise((resolve) => setTimeout(resolve, 500));
          await bot.sendMessage(
            chatId,
            `Vous suivez déjà *${JORFRes.data[0].prenom} ${JORFRes.data[0].nom}* ✅`,
            startKeyboard,
          );
        }
      }
    });
  } catch (error) {
    console.log(error);
  }
};
