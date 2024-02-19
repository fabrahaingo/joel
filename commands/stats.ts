import Users from "../models/User";
import People from "../models/People";
import { startKeyboard } from "../utils/keyboards";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
  try {
    await umami.log({ event: "/stats" });
    if (!msg.reply_to_message) {
      const usersCount = await Users.countDocuments();
      const peopleCount = await People.countDocuments();

      await bot.sendMessage(
        msg.chat.id,
        `📈 JOEL aujourd’hui c’est\n👨‍💻 ${usersCount} utilisateurs\n🕵️ ${peopleCount} personnes suivies\n\nJOEL sait combien vous êtes à l'utiliser mais il ne sait pas qui vous êtes... et il ne cherchera jamais à le savoir! 🛡`,
        startKeyboard
      );
    }
  } catch (error) {
    console.log(error);
  }
};
