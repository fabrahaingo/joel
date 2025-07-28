import {
  ButtonElement,
  ISession,
  IUser,
  KeyboardType,
  MessageApp
} from "../types.ts";
import TelegramBot from "node-telegram-bot-api";
import User from "../models/User.ts";
import { loadUser } from "./Session.ts";
import umami from "../utils/umami.ts";
import { splitText } from "../utils/text.utils.ts";

const mainMenuKeyboardTelegram: ButtonElement[][] = [
  [{ text: "🔎 Rechercher" }, { text: "👨‍💼 Ajouter une fonction" }],
  [{ text: "🏛️️ Ajouter une organisation" }, { text: "🧐 Lister mes suivis" }],
  [{ text: "❓ Aide / Contact" }]
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

  async sendMessage(
    msg: string,
    keyboard?: { text: string }[][],
    menuType?: KeyboardType
  ) {
    if (msg.length > 3000) {
      await this.sendLongMessage(msg, keyboard);
      return;
    }

    let options = telegramMessageOption;
    if (keyboard != null) {
      const keyboardFormatted = keyboard.map((row) =>
        row.map(({ text }) => ({ text }))
      );
      options = {
        ...telegramMessageOption,
        reply_markup: {
          ...telegramMessageOption.reply_markup,
          keyboard: keyboardFormatted
        }
      };
    }
    await this.telegramBot.sendMessage(this.chatId, msg, options);
  }

  async sendTypingAction() {
    await this.telegramBot.sendChatAction(this.chatId, "typing");
  }

  async sendLongMessage(
    formattedData: string,
    keyboard?: ButtonElement[][],
    menuType?: KeyboardType
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
