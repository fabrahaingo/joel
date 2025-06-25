import { ISession } from "../types";
import { TelegramSession } from "../entities/TelegramSession";
import { mainMenuKeyboard } from "../utils/keyboards";

export const defaultCommand = async (session: ISession, _msg: never): Promise<void> => {
  try {

    if (session.messageApp !== "Telegram") {
      return;
    }
    if (session !instanceof TelegramSession){
      console.log("Session messageApp set as Telegram, but session is not a TelegramSession");
      return;
    }

    const tgSession = session as TelegramSession;

    if (tgSession.telegramMessage == null){
      console.log("Received message in TelegramSession with missing TelegramMessage");
      return;
    }

    // only answer non-reply messages
    if (!tgSession.telegramMessage.reply_to_message) {
      await session.log({ event: "/default-message" });
      await session.sendMessage(
        `Je n'ai pas compris votre message 🥺\nMerci d'utiliser un des boutons ci-dessous pour interagir avec moi.`,
          mainMenuKeyboard
      );
    }
  } catch (error) {
    console.log(error);
  }
};
