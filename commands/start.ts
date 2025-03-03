import User from "../models/User";
import { startKeyboard } from "../utils/keyboards";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";
import { IUser } from "../types";
import { ErrorMessages } from "../entities/ErrorMessages";

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
  const chatId = msg.chat.id;
  await umami.log({ event: "/start" });

  const botName = process.env.BOT_NAME;
  const botChannel = process.env.BOT_CHANNEL;

  if (!botName) {
    throw new Error(ErrorMessages.BOTNAME_NOT_SET);
  }
  if (!botChannel) {
    throw new Error(ErrorMessages.BOTCHANNEL_NOT_SET);
  }

  try {
    await bot.sendChatAction(chatId, "typing");

    const user: IUser = await User.firstOrCreate({ tgUser: msg.from, chatId });
    if (user.status === "blocked") {
      user.status = "active";
      await user.save();
    }

    const text = `\n\u{1F41D} ${botName} vous permet de *consulter et suivre les évolutions de postes* de vos collègues et connaissances au sein de l'administration française.
		\nPour rester au courant des *nouveautés*, des *corrections* de bugs ainsi que des *améliorations* de JOEL, rejoignez notre channel officiel [@${botChannel}](https://t.me/${botChannel})`;

    await bot.sendMessage(chatId, text, startKeyboard);
  } catch (error) {
    console.log(error);
  }
};
