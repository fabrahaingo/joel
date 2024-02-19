import TelegramBot from "node-telegram-bot-api";
import { startKeyboard } from "../utils/keyboards";
import umami from "../utils/umami";

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
  try {
    // only answer to messages are not replies
    if (!msg.reply_to_message) {
      await umami.log({ event: "/default-message" });
      await bot.sendMessage(
        msg.chat.id,
        `Je n'ai pas compris votre message 🥺\nMerci d'utiliser un des boutons ci-dessous pour interagir avec moi.`,
        startKeyboard
      );
    }
  } catch (error) {
    console.log(error);
  }
};
