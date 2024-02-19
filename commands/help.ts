import TelegramBot from "node-telegram-bot-api";
import { sendLongText } from "../utils/sendLongText";
import umami from "../utils/umami";
import { HelpMessages } from "../entities/BotMessages";

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
  const chatId = msg.chat.id;
  await umami.log({ event: "/help" });
  await bot.sendChatAction(chatId, "typing");
  const helpText = HelpMessages.DEFAULT.replace("{chatId}", chatId.toString());
  await sendLongText(bot, chatId, helpText);
};
