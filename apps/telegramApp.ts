import "dotenv/config";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { mongodbConnect } from "../db.ts";
import { TelegramSession } from "../entities/TelegramSession.ts";
import { processMessage } from "../commands/Commands.ts";
import umami from "../utils/umami.ts";
import { startDailyNotificationJobs } from "../notifications/notificationScheduler.ts";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (TELEGRAM_BOT_TOKEN === undefined) {
  console.log("Telegram: env is not set, bot did not start \u{1F6A9}");
  process.exit(0);
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

await (async () => {
  await mongodbConnect();

  bot.on(message("text"), async (ctx): Promise<void> => {
    try {
      const tgUser = ctx.from;
      if (tgUser.is_bot) return;

      await umami.log({ event: "/message-received", messageApp: "Telegram" });

      const tgSession = new TelegramSession(
        TELEGRAM_BOT_TOKEN,
        bot.telegram,
        ctx.chat.id.toString(),
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

  startDailyNotificationJobs(["Telegram"], {
    telegramBotToken: TELEGRAM_BOT_TOKEN
  });
  console.log(`Telegram: JOEL started successfully \u{2705}`);

  await bot.launch();
})();
