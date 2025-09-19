import User from "../models/User.ts";
import { ISession } from "../types.ts";
import {
  extractTelegramSession,
  TelegramSession
} from "../entities/TelegramSession.ts";
import TelegramBot from "node-telegram-bot-api";

export const deleteProfileCommand = async (
  session: ISession
): Promise<void> => {
  await session.log({ event: "/delete-profile" });
  try {
    if (session.user == null) {
      await session.sendMessage(
        `Aucun profil utilisateur n'est actuellement associé à votre identifiant ${session.chatId}`
      );
      return;
    }

    const tgSession: TelegramSession | undefined = await extractTelegramSession(
      session,
      true
    );
    if (tgSession == null) return;

    const tgBot = tgSession.telegramBot;

    const question = await tgBot.sendMessage(
      tgSession.chatIdTg,
      `*Vous êtes sur le point de supprimer votre profil JOÉL*, comprenant l'ensemble de vos contacts, fonctions et organisations suivis.\n
⚠️ *Attention, ces données ne sont pas récupérables par la suite* ⚠️
Pour confirmer vous devez répondre "SUPPRIMER MON COMPTE" en majuscule à ce message`,
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
      (tgMsg: TelegramBot.Message) => {
        void (async () => {
          if (session.user == null) return;
          if (tgMsg.text === "SUPPRIMER MON COMPTE") {
            await User.deleteOne({
              _id: session.user._id
            });
            await session.sendMessage(
              `🗑 Votre profil a bien été supprimé ! 👋\nUn profil vierge sera créé lors de l'ajout du prochain suivi ⚠️`
            );
            await session.log({ event: "/user-deletion-self" });
          } else {
            await session.sendMessage("Suppression annulée.");
          }
        })();
      }
    );
  } catch (error) {
    console.log(error);
  }
};
