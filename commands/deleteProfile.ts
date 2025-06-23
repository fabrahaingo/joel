import { startKeyboard } from "../utils/keyboards";
import User from "../models/User";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";
import {IUser} from "../types";

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
  const chatId = msg.chat.id;
  await umami.log({ event: "/user-deletion-command" });
  try {
    const tgUser: TelegramBot.User | undefined = msg.from;
    if (tgUser === undefined) return;

    const user: IUser | null | undefined = await User.findOne({
      _id: tgUser.id,
      chatId,
    });

    if (user === null || user === undefined) {
      await bot.sendMessage(chatId, `Aucun profil utilisateur n'est actuellement associé à votre identifiant ${chatId}`, startKeyboard);
      return;
    }

    const question = await bot.sendMessage(
        chatId,
        `*Vous êtes sur le point de supprimer votre compte JOEL*, comprenant l'ensemble de vos contacts, fonctions et organisations suivis.\n
⚠️ *Attention, ces données ne sont pas récupérables par la suite* ⚠️
Pour confirmer vous devez répondre "SUPPRIMER MON COMPTE" en majuscule à ce message`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            force_reply: true,
          },
        }
    );
    bot.onReplyToMessage(chatId, question.message_id, async (msg) => {
      if (msg.text === "SUPPRIMER MON COMPTE") {
        await User.deleteOne({
          _id: tgUser.id,
          chatId,
        });
        await bot.sendMessage(chatId, `🗑 Votre profil a bien été supprimé ! 👋
⚠️ Un profil vierge sera créé lors de votre prochaine interaction avec JOEL ⚠️`
            , startKeyboard);
        await umami.log({ event: "/user-deletion-self" });
    } else {
        await bot.sendMessage(
            chatId,
            "Suppression annulée.",
            startKeyboard
        );
      }
    });

  } catch (error) {
    console.log(error);
  }
};
