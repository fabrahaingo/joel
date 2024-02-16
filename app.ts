import "dotenv/config";
import mongoose from "mongoose";
import TelegramBot from "node-telegram-bot-api";

const bot = new TelegramBot(process.env.BOT_TOKEN || "", {
  polling: true,
  onlyFirstMatch: true,
  filepath: false,
});

const commands: {
  regex: RegExp;
  action: (
    bot: TelegramBot
  ) => (msg: TelegramBot.Message, match: RegExpExecArray | null) => void;
}[] = [
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
  await mongoose.connect(process.env.MONGODB_URI || "");

  commands.forEach((command) => {
    bot.onText(command.regex, command.action(bot));
  });

  console.log(`\u{1F41D} ${process.env.BOT_NAME} started successfully`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
