import "dotenv/config";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { mongodbConnect, mongodbDisconnect } from "../db.ts";
import { TelegramSession } from "../entities/TelegramSession.ts";
import { startDailyNotificationJobs } from "../notifications/notificationScheduler.ts";
import { handleIncomingMessage } from "../utils/messageWorkflow.ts";
import { logError, logTelegramDebugStatus } from "../utils/debugLogger.ts";
import { mongoProbe, startHealthServer } from "../utils/healthServer.ts";
import { healthPort } from "../utils/healthProbe.ts";
import { isBlankEnv } from "../utils/env.utils.ts";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (isBlankEnv(TELEGRAM_BOT_TOKEN)) {
  console.log("Telegram: env is not set, bot did not start \u{1F6A9}");
  process.exit(0);
}

// Report whether debug notifications are usable (env set and not left as an
// unresolved Coolify "{{...}}" placeholder) before the bot starts.
logTelegramDebugStatus();

/**
 * How long a getMe result stands in for the polling connection.
 *
 * Telegraf exposes no "last update received" signal, so reaching the Bot API
 * is the available proof that the token still works and Telegram is
 * answering. Memoizing keeps a 30s container probe to one API call.
 */
const TELEGRAM_API_TTL_MS = 20_000;
const TELEGRAM_API_TIMEOUT_MS = 5000;

await (async () => {
  const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
  // Register stopper
  let shuttingDown = false;
  let healthServer: ReturnType<typeof startHealthServer> | undefined;
  try {
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log(`Telegram: Received ${signal}, shutting down...`);

      try {
        // Stop starting new work
        bot.stop(); // sets stopSyncing=true (not async)
        healthServer?.close();

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

    // Global error handler for Telegraf
    bot.catch(async (error) => {
      await logError("Telegram", "Unhandled error in bot handler", error);
    });

    startDailyNotificationJobs(["Telegram"], {
      telegramBotToken: TELEGRAM_BOT_TOKEN
    });

    let apiCheckedAt = 0;
    let apiReachable = true;
    healthServer = startHealthServer(
      "Telegram",
      healthPort("telegram", process.env),
      {
        mongo: mongoProbe,
        telegramApi: async () => {
          if (Date.now() - apiCheckedAt < TELEGRAM_API_TTL_MS)
            return apiReachable
              ? { ok: true }
              : { ok: false, detail: "Telegram API unreachable" };

          try {
            await Promise.race([
              bot.telegram.getMe(),
              new Promise((_, reject) => {
                setTimeout(() => {
                  reject(new Error("Telegram getMe timed out"));
                }, TELEGRAM_API_TIMEOUT_MS).unref();
              })
            ]);
            apiReachable = true;
            return { ok: true };
          } catch (error) {
            apiReachable = false;
            return {
              ok: false,
              detail: error instanceof Error ? error.message : String(error)
            };
          } finally {
            apiCheckedAt = Date.now();
          }
        }
      }
    );

    console.log(`Telegram: JOEL started successfully \u{2705}`);
    await bot.launch();
  } catch (error) {
    await logError("Telegram", "Failed to start app", error);
  }
})();
