import { mainMenuKeyboard } from "../utils/keyboards.js";
import User from "../models/User.js";
import { ISession } from "../types.js";
import { extractTelegramSession, TelegramSession } from "../entities/TelegramSession.js";
import TelegramBot from "node-telegram-bot-api";

export const deleteProfileCommand = async (session: ISession, _msg: never): Promise<void> => {
  await session.log({ event: "/delete-profile" });
  try {
    if (session.user == null) {
      await session.sendMessage(
          `Aucun profil utilisateur n'est actuellement associé à votre identifiant ${String(session.chatId)}`,
          mainMenuKeyboard);
      return;
    }

    const tgSession: TelegramSession | undefined = await extractTelegramSession(session, true);
    if (tgSession == null) return;

    const tgBot = tgSession.telegramBot;

    const question = await tgBot.sendMessage(
        session.chatId,
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
    tgBot.onReplyToMessage(session.chatId, question.message_id, (tgMsg: TelegramBot.Message) => {
      void (async () => {
          if (tgMsg.text === "SUPPRIMER MON COMPTE") {
          await User.deleteOne({
            _id: session.chatId,
            chatId: session.chatId,
          });
          await session.sendMessage( `🗑 Votre profil a bien été supprimé ! 👋
  ⚠️ Un profil vierge sera créé lors de votre prochaine interaction avec JOEL ⚠️`
              , mainMenuKeyboard);
          await session.log({ event: "/user-deletion-self" });
      } else {
          await session.sendMessage(
              "Suppression annulée.",
              mainMenuKeyboard
          );
        }
      })();
    });

  } catch (error) {
    console.log(error);
  }
};
