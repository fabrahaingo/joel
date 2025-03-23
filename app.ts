import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { CommandType } from "./types";
import { mongodbConnect } from "./db";
import { TelegramSession } from "./entities/TelegramSession";

const bot: TelegramBot = new TelegramBot(process.env.BOT_TOKEN || "", {
  polling: true,
  onlyFirstMatch: true,
});

const commands: CommandType = [
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
    regex: /.*/,
    action: require("./commands/default"),
  },
];

(async () => {
  await mongodbConnect();

  commands.forEach((command) => {
    bot.onText(command.regex,
        async (msg: TelegramBot.Message) => {
          // Check if user is defined
          const tgUser: TelegramBot.User | undefined = msg.from;
          if (tgUser === undefined || tgUser.is_bot) return // Ignore bots

          const tgSession = new TelegramSession(bot, msg.chat.id);
          await tgSession.loadUser();

          // Process user message
          command.action(bot)(msg)
        })
    ;
  });

  console.log(`\u{2705} JOEL started successfully`);
})();
