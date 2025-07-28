import "dotenv/config";
import TelegramBot, { ChatId } from "node-telegram-bot-api";
import { mongodbConnect } from "./db.ts";
import { TelegramSession } from "./entities/TelegramSession.ts";
import { commands } from "./commands/Commands.ts";
import umami from "./utils/umami.ts";
import { ErrorMessages } from "./entities/ErrorMessages.ts";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (BOT_TOKEN === undefined)
  throw new Error(ErrorMessages.TELEGRAM_BOT_TOKEN_NOT_SET);

const bot: TelegramBot = new TelegramBot(BOT_TOKEN, {
  polling: true,
  onlyFirstMatch: true
});

await (async () => {
  await mongodbConnect();

  commands.forEach((command) => {
    bot.onText(command.regex, (tgMsg: TelegramBot.Message) => {
      void (async () => {
        await umami.log({ event: "/message-telegram" });
        try {
          // Check if the user is known
          const tgUser: TelegramBot.User | undefined = tgMsg.from;
          if (tgUser === undefined || tgUser.is_bot) return; // Ignore bots

          const tgSession = new TelegramSession(
            bot,
            tgMsg.chat.id,
            tgUser.language_code ?? "fr"
          );
          await tgSession.loadUser();
          tgSession.isReply = tgMsg.reply_to_message !== undefined;

          if (tgSession.user != null)
            await tgSession.user.updateInteractionMetrics();

          // Process user message
          await command.action(tgSession, tgMsg.text);
        } catch (error) {
          console.error("Error processing command:", error);
        }
      })();
    });
  });

  console.log(`\u{2705} JOEL started successfully`);
})();
