import { ButtonElement, ISession, IUser, MessageApp } from "../types.ts";
import TelegramBot, { ChatId } from "node-telegram-bot-api";
import User from "../models/User.ts";
import { loadUser } from "./Session.ts";
import umami from "../utils/umami.ts";
import { splitText } from "../utils/text.utils.ts";
import { ErrorMessages } from "./ErrorMessages.ts";
import axios, { AxiosError, isAxiosError } from "axios";

const mainMenuKeyboardTelegram: ButtonElement[][] = [
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
  mainMenuKeyboard: ButtonElement[][];

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

  async sendMessage(
    formattedData: string,
    keyboard?: ButtonElement[][]
  ): Promise<void> {
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
    const mArr = splitText(formattedData, 3000);

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
            const user: IUser | null = await User.findOne({
              messageApp: "Telegram",
              chatId: chatId as ChatId
            });
            if (user != null) {
              user.status = "blocked";
              await user.save();
            }
            return;
          }
        }
        console.log(err);
      });
    await umami.log({ event: "/message-sent-telegram" });

    // prevent hitting the Telegram API rate limit
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
