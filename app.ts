import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { CommandType } from "./types";
import { mongodbConnect } from "./db";

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
    regex: /\/supprimerCompte/,
    action: require("./commands/supprimerCompte"),
  },
  {
    regex: /.*/,
    action: require("./commands/default"),
  },
];

(async () => {
  await mongodbConnect();

  commands.forEach((command) => {
    bot.onText(command.regex, command.action(bot));
  });

  console.log(`\u{2705} JOEL started successfully`);
})();
