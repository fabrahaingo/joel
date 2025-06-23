import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { CommandType, IUser } from "./types";
import { mongodbConnect } from "./db";
import { followOrganisationCommand } from "./commands/followOrganisation";
import User from "./models/User";
import { followCommand, fullHistoryCommand, searchCommand } from "./commands/search";
import { enaCommand, promosCommand } from "./commands/ena";

const bot: TelegramBot = new TelegramBot(process.env.BOT_TOKEN || "", {
  polling: true,
  onlyFirstMatch: true,
});

const commands: CommandType = [
  {
    regex: /\/start$|🏠 Menu principal/,
    action: require("./commands/start"),
  },
  {
    regex: /🔎 Rechercher$|🔎 Nouvelle recherche$/,
    action: searchCommand,
  },
  {
    regex: /Historique de \s*(.*)/i,
    action: fullHistoryCommand,
  },
  {
    regex: /Suivre \s*(.*)/i,
    action: followCommand,
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
    regex: /\/secret|\/ENA|\/INSP/i,
    action: enaCommand,
  },
  {
    regex: /\/promos/,
    action: promosCommand,
  },
  {
    regex: /\/stats/,
    action: require("./commands/stats"),
  },
  {
    regex: /\/followOrganisation|\/followOrganization/i,
    action: followOrganisationCommand,
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

(async () => {
  await mongodbConnect();

  commands.forEach((command) => {
    bot.onText(command.regex,
        async (msg: TelegramBot.Message) => {
          // Check if user is defined
          const tgUser: TelegramBot.User | undefined = msg.from;
          if (tgUser === undefined) return
          const user: IUser | null = await User.findOne({ chatId: msg.chat.id });
          if (user !== null) await user.updateInteractionMetrics();

          // Process user message
          command.action(bot)(msg)
        })
        ;
  });

  console.log(`\u{2705} JOEL started successfully`);
})();
