import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { CommandType, IUser } from "./types";
import { mongodbConnect } from "./db";
import User from "./models/User";

const bot: TelegramBot = new TelegramBot(process.env.BOT_TOKEN || "", {
  polling: true,
  onlyFirstMatch: true,
});

const commands: CommandType[] = [
  {
    regex: /\/start$/,
    action: require("./commands/start"),
  },
  {
    regex: /🔎 Rechercher$/,
    action: require("./commands/search"),
  },
  {
    regex: /🧩 Ajouter un contact$/,
    action: require("./commands/follow"),
  },
  {
    regex: /✋ Retirer un suivi$/,
    action: require("./commands/unfollow"),
  },
  {
    regex: /🧐 Lister mes suivis$/,
    action: require("./commands/list"),
  },
  {
    regex: /❓ Aide/,
    action: require("./commands/help"),
  },
  {
    regex: /👨‍💼 Ajouter une fonction/,
    action: require("./commands/followFunction"),
  },
  {
    regex: /\/secret|\/ena|\/ENA|\/insp|\/INSP/,
    action: require("./commands/ena"),
  },
  {
    regex: /\/stats/,
    action: require("./commands/stats"),
  },
  {
    regex: /\/supprimerCompte/,
    action: require("./commands/deleteProfile"),
  },
  {
    regex: /.*/,
    action: require("./commands/default"),
  },
];

export const commandHandler = (command: CommandType) => {
  bot.onText(command.regex,
      async (msg: TelegramBot.Message) => {
        // Check if user is defined
        const tgUser: TelegramBot.User | undefined = msg.from;
        if (tgUser === undefined) return
        const user: IUser | null = await User.findOne({ chatId: msg.chat.id });
        if (user !== null) await user.saveDailyInteraction();

        // Process user message
        command.action(bot)(msg)
      })
  ;
}

(async () => {
  await mongodbConnect();

  commands.forEach(commandHandler);

  console.log(`\u{2705} JOEL started successfully`);
})();

