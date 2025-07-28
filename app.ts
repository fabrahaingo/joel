import "dotenv/config";
import TelegramBot, { ChatId } from "node-telegram-bot-api";
import { mongodbConnect } from "./db.ts";
import { TelegramSession } from "./entities/TelegramSession.ts";
import { commands } from "./commands/Commands.ts";
import umami from "./utils/umami.ts";
import { splitText } from "./utils/text.utils.ts";
import { ErrorMessages } from "./entities/ErrorMessages.ts";
import axios, { AxiosError, isAxiosError } from "axios";
import { TelegramAPIError } from "./scripts/notifyUsers.ts";
import Blocked from "./models/Blocked.ts";

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

export async function sendTelegramMessage(chatId: number, message: string) {
  const messagesArray = splitText(message, 3000);

  if (BOT_TOKEN === undefined) {
    throw new Error(ErrorMessages.TELEGRAM_BOT_TOKEN_NOT_SET);
  }

  for (const message of messagesArray) {
    await axios
      .post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: message,
        parse_mode: "markdown",
        link_preview_options: {
          is_disabled: true
        }
      })
      .catch(async (err: unknown) => {
        if (isAxiosError(err)) {
          const error = err as AxiosError<TelegramAPIError>;
          if (
            error.response?.data.description !== undefined &&
            error.response.data.description ===
              "Forbidden: bot was blocked by the user"
          ) {
            await umami.log({ event: "/user-blocked-joel" });
            await new Blocked({
              chatId: chatId as ChatId
            }).save();
            return;
          }
        }
        console.log(err);
      });

    // prevent hitting the Telegram API rate limit
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
