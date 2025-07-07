import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { mongodbConnect } from "./db.js";
import { TelegramSession } from "./entities/TelegramSession.js";
import { commands } from "./commands/Commands.js";

const bot: TelegramBot = new TelegramBot(process.env.BOT_TOKEN ?? "", {
  polling: true,
  onlyFirstMatch: true,
});


await (async () => {
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

            if (tgSession.user != null) await tgSession.user.updateInteractionMetrics();

          // Process user message
          await command.action(tgSession, tgMsg.text)
        })
        ;
  });

  console.log(`\u{2705} JOEL started successfully`);
})();
