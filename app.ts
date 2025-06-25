import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { CommandType } from "./types";
import { mongodbConnect } from "./db";
import { TelegramSession } from "./entities/TelegramSession";

import { followOrganisationCommand } from "./commands/followOrganisation";
import { followCommand, fullHistoryCommand, searchCommand } from "./commands/search";
import { enaCommand, promosCommand } from "./commands/ena";
import { statsCommand } from "./commands/stats";
import { defaultCommand } from "./commands/default";
import { startCommand } from "./commands/start";
import { deleteProfileCommand } from "./commands/deleteProfile";
import { helpCommand } from "./commands/help";
import { followFunctionCommand } from "./commands/followFunction";
import { listCommand } from "./commands/list";
import { unfollowCommand } from "./commands/unfollow";

const bot: TelegramBot = new TelegramBot(process.env.BOT_TOKEN || "", {
  polling: true,
  onlyFirstMatch: true,
});

const commands: CommandType[] = [
  {
    regex: /\/start$|🏠 Menu principal/,
    action: startCommand,
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
    action: unfollowCommand,
  },
  {
    regex: /🧐 Lister mes suivis$/,
    action: listCommand,
  },
  {
    regex: /❓ Aide/,
    action: helpCommand,
  },
  {
    regex: /👨‍💼 Ajouter une fonction/,
    action: followFunctionCommand,
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
    action: statsCommand,
  },
  {
    regex: /🏛️️ Ajouter une organisation|\/followOrganisation|\/followOrganization/i,
    action: followOrganisationCommand,
  },
  {
    regex: /\/supprimerCompte/,
    action: deleteProfileCommand,
  },
  {
    regex: /.*/,
    action: defaultCommand,
  },
];

(async () => {
  await mongodbConnect();

  commands.forEach((command) => {
    bot.onText(command.regex,
        async (tgMsg: TelegramBot.Message) => {

            // Check if the user is known
            const tgUser: TelegramBot.User | undefined = tgMsg.from;
            if (tgUser === undefined || tgUser.is_bot) return // Ignore bots

            const tgSession = new TelegramSession(bot, tgMsg.chat.id, tgUser.language_code ?? "fr");
            await tgSession.loadUser();
            tgSession.isReply = tgMsg.reply_to_message !== undefined;

            if (tgSession.user !== null) await tgSession.user.updateInteractionMetrics();

          // Process user message
          await command.action(tgSession, tgMsg.text)
        })
        ;
  });

  console.log(`\u{2705} JOEL started successfully`);
})();
