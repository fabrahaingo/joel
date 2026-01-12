import "dotenv/config";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { mongodbConnect, mongodbDisconnect } from "../db.ts";
import { TelegramSession } from "../entities/TelegramSession.ts";
import { startDailyNotificationJobs } from "../notifications/notificationScheduler.ts";
import { handleIncomingMessage } from "../utils/messageWorkflow.ts";
import { logError } from "../utils/debugLogger.ts";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (TELEGRAM_BOT_TOKEN === undefined) {
  console.log("Telegram: env is not set, bot did not start \u{1F6A9}");
  process.exit(0);
}

await (async () => {
  const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
  // Register stopper
  let shuttingDown = false;
  try {
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log(`Telegram: Received ${signal}, shutting down...`);

      try {
        // Stop starting new work
        bot.stop(); // sets stopSyncing=true (not async)

        // Close DB cleanly
        await mongodbDisconnect();

        // Let stdout flush naturally; do not force-exit yet
        process.exitCode = 0;
      } catch (error) {
        await logError("Telegram", `Error during ${signal} shutdown`, error);
        process.exitCode = 1;
      }

      // Safety net: if something keeps the event loop alive, force exit.
      setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
    };

    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      process.once(sig, () => {
        void shutdown(sig);
      });
    }

    // Start the bot by connecting to MongoDB
    await mongodbConnect();

    bot.on(message("text"), async (ctx): Promise<void> => {
      const tgUser = ctx.from;
      if (tgUser.is_bot) return;

      const messageSentTime = new Date(ctx.message.date * 1000);

      const tgSession = new TelegramSession(
        TELEGRAM_BOT_TOKEN,
        bot.telegram,
        ctx.chat.id.toString(),
        tgUser.language_code ?? "fr",
        messageSentTime
      );

      await handleIncomingMessage(tgSession, ctx.message.text, {
        isReply: ctx.message.reply_to_message !== undefined,
        errorContext: "Error processing command"
      });
    });

    startDailyNotificationJobs(["Telegram"], {
      telegramBotToken: TELEGRAM_BOT_TOKEN
    });
    console.log(`Telegram: JOEL started successfully \u{2705}`);
    await bot.launch();
  } catch (error) {
    await logError("Telegram", "Failed to start app", error);
  }
})();
