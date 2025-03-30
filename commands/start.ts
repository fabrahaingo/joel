import User from "../models/User";
import { startKeyboard } from "../utils/keyboards";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";
import { IUser } from "../types";

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
  const chatId = msg.chat.id;
  await umami.log({ event: "/start" });
  try {
    bot.sendChatAction(chatId, "typing");

    const tgUser: TelegramBot.User | undefined = msg.from;
    if (tgUser === undefined) return;
    const user = await User.firstOrCreate({
      tgUser,
      chatId,
      messageApp: "Telegram"
    });
    if (user === null) return;

    if (user.status === "blocked") {
      user.status = "active";
      await user.save();
    }

    const botName = process.env.BOT_NAME;
    const botChannel = process.env.BOT_CHANNEL;

    const text = `\n\u{1F41D} ${botName} vous permet de *consulter et suivre les évolutions de postes* de vos collègues et connaissances au sein de l'administration française.
		\nPour rester au courant des *nouveautés*, des *corrections* de bugs ainsi que des *améliorations* de JOEL, rejoignez notre channel officiel [@${botChannel}](https://t.me/${botChannel})`;

    await bot.sendMessage(chatId, text, startKeyboard);
  } catch (error) {
    console.log(error);
  }
};
