import { Keyboard, ISession, IUser, MessageApp } from "../types.ts";
import TelegramBot from "node-telegram-bot-api";
import User from "../models/User.ts";
import { loadUser } from "./Session.ts";
import umami from "../utils/umami.ts";
import { splitText } from "../utils/text.utils.ts";
import { ErrorMessages } from "./ErrorMessages.ts";
import axios, { AxiosError, isAxiosError } from "axios";

const TELEGRAM_MESSAGE_CHAR_LIMIT = 3000;
const TELEGRAM_COOL_DOWN_DELAY_SECONDS = 1; // 1 message per second for the same user

export const TELEGRAM_API_SENDING_CONCURRENCY = 30; // 30 messages per second global

const mainMenuKeyboardTelegram: Keyboard = [
  [{ text: "🔎 Rechercher" }, { text: "🧐 Lister mes suivis" }],
  [
    { text: "🏛️️ Ajouter une organisation" },
    { text: "👨‍💼 Ajouter une fonction" }
  ],
  [{ text: "❓ Aide & Contact" }]
];

export const telegramMessageOption: TelegramBot.SendMessageOptions = {
  parse_mode: "Markdown",
  disable_web_page_preview: true,
  reply_markup: {
    selective: true,
    resize_keyboard: true,
    keyboard: []
  }
};

const TelegramMessageApp: MessageApp = "Telegram";

export class TelegramSession implements ISession {
  messageApp = TelegramMessageApp;
  telegramBot: TelegramBot;
  language_code: string;
  chatId: number;
  user: IUser | null | undefined = undefined;
  isReply: boolean | undefined;
  mainMenuKeyboard: Keyboard;

  log = umami.log;

  constructor(telegramBot: TelegramBot, chatId: number, language_code: string) {
    this.telegramBot = telegramBot;
    this.chatId = chatId;
    this.language_code = language_code;
    this.mainMenuKeyboard = mainMenuKeyboardTelegram;
  }

  // try to fetch user from db
  async loadUser(): Promise<void> {
    this.user = await loadUser(this);
  }

  // Force create a user record
  async createUser() {
    this.user = await User.findOrCreate(this);
  }

  async sendTypingAction() {
    await this.telegramBot.sendChatAction(this.chatId, "typing");
  }

  async sendMessage(formattedData: string, keyboard?: Keyboard): Promise<void> {
    let optionsWithKeyboard = telegramMessageOption;
    if (keyboard != null) {
      const keyboardFormatted = keyboard.map((row) =>
        row.map(({ text }) => ({ text }))
      );
      optionsWithKeyboard = {
        ...telegramMessageOption,
        reply_markup: {
          ...telegramMessageOption.reply_markup,
          keyboard: keyboardFormatted
        }
      };
    }
    const mArr = splitText(formattedData, TELEGRAM_MESSAGE_CHAR_LIMIT);

    for (let i = 0; i < mArr.length; i++) {
      if (i == mArr.length - 1 && keyboard !== undefined) {
        await this.telegramBot.sendMessage(
          this.chatId,
          mArr[i],
          optionsWithKeyboard
        );
      } else {
        await this.telegramBot.sendMessage(
          this.chatId,
          mArr[i],
          telegramMessageOption
        );
      }
      await umami.log({ event: "/message-sent-telegram" });

      // prevent hitting the Telegram API rate limit
      await new Promise((resolve) =>
        setTimeout(resolve, TELEGRAM_COOL_DOWN_DELAY_SECONDS * 1000)
      );
    }
  }
}

export async function extractTelegramSession(
  session: ISession,
  userFacingError?: boolean
): Promise<TelegramSession | undefined> {
  if (session.messageApp !== "Telegram") {
    console.log("Session is not a TelegramSession");
    if (userFacingError) {
      await session.sendMessage(
        `Cette fonctionnalité n'est pas encore disponible sur ${session.messageApp}`,
        session.mainMenuKeyboard
      );
    }
    return undefined;
  }
  if (!(session instanceof TelegramSession)) {
    console.log(
      "Session messageApp is Telegram, but session is not a TelegramSession"
    );
    return undefined;
  }

  return session;
}

// Extend the AxiosError with the response.data.description field
interface TelegramAPIError {
  message: string;
  status: number;
  description?: string;
}

const BOT_TOKEN = process.env.BOT_TOKEN;

/*
 Returns whether the message was successfully sent. Two error cases are handled:
 1. If the user blocked the bot, the user is marked as blocked in the database.
 2. If the user is deactivated, the user is deleted from the database.
*/
export async function sendTelegramMessage(
  chatId: number,
  message: string,
  retryNumber = 0
): Promise<boolean> {
  if (retryNumber > 5) {
    await umami.log({ event: "/telegram-too-many-requests-aborted" });
    return false;
  }
  const mArr = splitText(message, TELEGRAM_MESSAGE_CHAR_LIMIT);

  if (BOT_TOKEN === undefined) {
    throw new Error(ErrorMessages.TELEGRAM_BOT_TOKEN_NOT_SET);
  }
  let i = 1;
  try {
    for (; i < mArr.length; i++) {
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: mArr[i],
        parse_mode: "markdown",
        link_preview_options: {
          is_disabled: true
        }
      });
      await umami.log({ event: "/message-sent-telegram" });

      // prevent hitting the Telegram API rate limit
      await new Promise((resolve) =>
        setTimeout(resolve, TELEGRAM_COOL_DOWN_DELAY_SECONDS * 1000)
      );
    }
  } catch (err) {
    if (isAxiosError(err)) {
      const error = err as AxiosError<TelegramAPIError>;
      switch (error.response?.data.description) {
        case "Forbidden: bot was blocked by the user":
          await umami.log({ event: "/user-blocked-joel" });
          await User.updateOne(
            { messageApp: "Telegram", chatId: chatId },
            { $set: { status: "blocked" } }
          );
          break;
        case "Forbidden: user is deactivated":
          await umami.log({ event: "/user-deactivated" });
          await User.deleteOne({
            messageApp: "Telegram",
            chatId: chatId
          });
          break;
        case "Too many requests":
          await umami.log({ event: "/telegram-too-many-requests" });
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, retryNumber) * 1000)
          );
          // retry sending the remainder of the message, indicating this is a retry
          return sendTelegramMessage(
            chatId,
            mArr.slice(i).join("`n"),
            retryNumber + 1
          );
        default:
          console.log(err);
          break;
      }
    }
    return false;
  }

  return true;
}
