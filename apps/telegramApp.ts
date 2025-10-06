import "dotenv/config";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { mongodbConnect } from "../db.ts";
import { TelegramSession } from "../entities/TelegramSession.ts";
import { processMessage } from "../commands/Commands.ts";
import umami from "../utils/umami.ts";
import { ErrorMessages } from "../entities/ErrorMessages.ts";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (BOT_TOKEN === undefined) {
  console.log(ErrorMessages.TELEGRAM_BOT_TOKEN_NOT_SET);
  console.log("Shutting down JOEL Telegram bot... \u{1F6A9}");
  process.exit(0);
}

const bot = new Telegraf(BOT_TOKEN);

await (async () => {
  await mongodbConnect();

  bot.on(message("text"), async (ctx): Promise<void> => {
    try {
      const tgUser = ctx.from;
      if (tgUser.is_bot) return;

      await umami.log("/message-telegram", "Telegram");

      const tgSession = new TelegramSession(
        bot.telegram,
        ctx.chat.id,
        tgUser.language_code ?? "fr"
      );
      await tgSession.loadUser();
      tgSession.isReply = ctx.message.reply_to_message !== undefined;

      if (tgSession.user != null)
        await tgSession.user.updateInteractionMetrics();

      await processMessage(tgSession, ctx.message.text);
    } catch (error) {
      console.error("Telegram: Error processing command:", error);
    }
  });
  console.log(`Telegram: JOEL started successfully \u{2705}`);

  await bot.launch();
})();
