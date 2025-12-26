import "dotenv/config";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { mongodbConnect } from "../db.ts";
import { TelegramSession } from "../entities/TelegramSession.ts";
import { startDailyNotificationJobs } from "../notifications/notificationScheduler.ts";
import { handleIncomingMessage } from "../utils/messageWorkflow.ts";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (TELEGRAM_BOT_TOKEN === undefined) {
  console.log("Telegram: env is not set, bot did not start \u{1F6A9}");
  process.exit(0);
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

await (async () => {
  await mongodbConnect();

  bot.on(message("text"), async (ctx): Promise<void> => {
    const tgUser = ctx.from;
    if (tgUser.is_bot) return;

    const messageSentTime = new Date(ctx.message.date * 1000); // TODO: use the real message timestamp

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
})();
