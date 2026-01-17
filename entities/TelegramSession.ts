import { ISession, IUser, MessageApp } from "../types.ts";
import { Telegram } from "telegraf";
import User from "../models/User.ts";
import {
  ExternalMessageOptions,
  loadUser,
  MessageSendingOptionsInternal,
  recordSuccessfulDelivery
} from "./Session.ts";
import umami, { UmamiEvent, UmamiLogger } from "../utils/umami.ts";
import { splitText } from "../utils/text.utils.ts";
import { deleteUserAndCleanup } from "../utils/userDeletion.utils.ts";
import axios, { AxiosError, isAxiosError } from "axios";
import { Keyboard, KEYBOARD_KEYS } from "./Keyboard.ts";
import { ExtraReplyMessage } from "telegraf/typings/telegram-types";
import { logError } from "../utils/debugLogger.ts";
import pLimit from "p-limit";

export const TELEGRAM_MESSAGE_CHAR_LIMIT = 3000;
export const TELEGRAM_COOL_DOWN_DELAY_SECONDS = 1; // 1 message per second for the same user

export const TELEGRAM_API_SENDING_CONCURRENCY = 30; // 30 messages per second global

const MAX_MESSAGE_RETRY = 5;

const mainMenuKeyboardTelegram: Keyboard = [
  [KEYBOARD_KEYS.PEOPLE_SEARCH.key, KEYBOARD_KEYS.FUNCTION_FOLLOW.key],
  [KEYBOARD_KEYS.ORGANISATION_FOLLOW.key, KEYBOARD_KEYS.TEXT_SEARCH.key],
  [KEYBOARD_KEYS.FOLLOWS_LIST.key, KEYBOARD_KEYS.HELP.key]
];

export const telegramMessageOptions: ExtraReplyMessage = {
  parse_mode: "Markdown",
  link_preview_options: {
    is_disabled: true
  },
  reply_markup: {
    selective: true,
    resize_keyboard: true,
    keyboard: []
  }
};

const TelegramMessageApp: MessageApp = "Telegram";

export class TelegramSession implements ISession {
  messageApp = TelegramMessageApp;
  botToken: string;
  telegramBot: Telegram;
  language_code: string;
  chatId: string;
  chatIdTg: number;
  user: IUser | null | undefined = undefined;
  isReply: boolean | undefined;
  mainMenuKeyboard: Keyboard;
  lastEngagementAt: Date;

  constructor(
    botToken: string,
    telegramBot: Telegram,
    chatId: string,
    language_code: string,
    lastEngagementAt: Date
  ) {
    this.botToken = botToken;
    this.telegramBot = telegramBot;
    this.chatId = chatId;
    this.chatIdTg = parseInt(chatId);
    this.language_code = language_code;
    this.mainMenuKeyboard = mainMenuKeyboardTelegram;

    this.lastEngagementAt = lastEngagementAt;
  }

  // try to fetch user from db
  async loadUser(): Promise<IUser | null> {
    this.user = await loadUser(this);
    return this.user;
  }

  // Force create a user record
  async createUser() {
    this.user = await User.findOrCreate(this);
  }

  sendTypingAction() {
    void sendTelegramTypingAction(
      this.chatIdTg,
      this.botToken,
      this.user != null
    );
  }

  log(args: { event: UmamiEvent; payload?: Record<string, unknown> }) {
    umami.log({
      event: args.event,
      messageApp: this.messageApp,
      payload: args.payload,
      hasAccount: this.user != null
    });
  }

  async sendMessage(
    formattedData: string,
    options?: MessageSendingOptionsInternal
  ): Promise<boolean> {
    return await sendTelegramMessage(
      this.botToken,
      this.chatId,
      formattedData,
      {
        ...options,
        keyboard:
          options?.keyboard ??
          (!options?.forceNoKeyboard ? this.mainMenuKeyboard : undefined),
        useAsyncUmamiLog: false,
        hasAccount: this.user != null
      }
    );
  }

  extractMessageAppsOptions(): ExternalMessageOptions {
    return { telegramBotToken: this.botToken };
  }
}

export async function extractTelegramSession(
  session: ISession,
  userFacingError?: boolean
): Promise<TelegramSession | undefined> {
  if (session.messageApp !== "Telegram") {
    await logError(
      session.messageApp,
      "Error extracting telegram session from session"
    );
    if (userFacingError) {
      await session.sendMessage(
        `Cette fonctionnalité n'est pas encore disponible sur ${session.messageApp}`
      );
    }
    return undefined;
  }
  if (!(session instanceof TelegramSession)) {
    await logError(
      session.messageApp,
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

/*
 Returns whether the message was successfully sent. Two error cases are handled:
 1. If the user blocked the bot, the user is marked as blocked in the database.
 2. If the user is deactivated, the user is deleted from the database.
*/
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  message: string,
  options: MessageSendingOptionsInternal,
  retryNumber = 0
): Promise<boolean> {
  const umamiLogger: UmamiLogger = options.useAsyncUmamiLog
    ? umami.logAsync
    : umami.log;

  const mArr = splitText(message, TELEGRAM_MESSAGE_CHAR_LIMIT);

  const chatIdTg = parseInt(chatId);
  let i = 0;
  try {
    for (; i < mArr.length; i++) {
      const payload: Record<string, unknown> = {
        chat_id: chatIdTg,
        text: mArr[i],
        parse_mode: "markdown",
        link_preview_options: {
          is_disabled: true
        }
      };
      if (i == mArr.length - 1 && options.keyboard !== undefined) {
        payload.reply_markup = {
          selective: true,
          resize_keyboard: true,
          keyboard: options.keyboard
        };
      }
      await axios.post(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        payload
      );
      await umamiLogger({
        event: "/message-sent",
        messageApp: "Telegram",
        hasAccount: options.hasAccount
      });

      // prevent hitting the Telegram API rate limit
      await new Promise((resolve) =>
        setTimeout(resolve, TELEGRAM_COOL_DOWN_DELAY_SECONDS * 1000)
      );
    }
  } catch (err) {
    const retryFunction = async (nextRetryNumber: number): Promise<boolean> => {
      return sendTelegramMessage(
        botToken,
        chatId,
        mArr.slice(i).join("\n"),
        options,
        nextRetryNumber
      );
    };
    return await handleTelegramAPIErrors(
      err,
      "sendTelegramMessage",
      chatIdTg,
      umamiLogger,
      {
        retryFunction,
        retryNumber
      }
    );
  }

  await recordSuccessfulDelivery("Telegram", chatId);
  return true;
}

async function sendTelegramTypingAction(
  chatIdTg: number,
  botToken: string,
  hasAccount: boolean,
  expectedStatus: "active" | "blocked" = "active",
  retryNumber = 0
): Promise<boolean> {
  const umamiLogger: UmamiLogger = umami.logAsync;
  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
      chat_id: chatIdTg,
      action: "typing"
    });
    // don't rely on recordSuccessfulDelivery which has higher footprint and is not necessary here
    if (expectedStatus === "blocked") {
      await User.updateOne(
        { messageApp: "Telegram", chatId: chatIdTg.toString() },
        { $set: { status: "active" } }
      );
      await umami.logAsync({
        event: "/user-unblocked-joel",
        messageApp: "Telegram"
      });
    }
  } catch (err) {
    const retryFunction = async (nextRetryNumber: number): Promise<boolean> => {
      return sendTelegramTypingAction(
        chatIdTg,
        botToken,
        hasAccount,
        expectedStatus,
        nextRetryNumber
      );
    };
    return await handleTelegramAPIErrors(
      err,
      "sendTelegramTypingAction",
      chatIdTg,
      umamiLogger,
      {
        retryFunction,
        retryNumber
      }
    );
  }
  return true;
}

export async function refreshTelegramBlockedUsers(
  botToken: string | undefined
): Promise<void> {
  if (botToken == null) return;

  const blockedTelegramUsers = await User.find({
    messageApp: "Telegram",
    status: "blocked"
  })
    .select("chatId")
    .lean();

  if (blockedTelegramUsers.length === 0) return;

  const limit = pLimit(TELEGRAM_API_SENDING_CONCURRENCY);

  await Promise.all(
    blockedTelegramUsers.map(({ chatId }) =>
      limit(async () =>
        sendTelegramTypingAction(
          Number.parseInt(chatId),
          botToken,
          true,
          "blocked"
        )
      )
    )
  );
}

async function handleTelegramAPIErrors(
  error: unknown,
  callerFunctionLabel: string,
  chatIdTg: number,
  umamiLogger: UmamiLogger,
  retryParameters?: {
    retryFunction: (retryNumber: number) => Promise<boolean>;
    retryNumber: number;
  }
): Promise<boolean> {
  const user: IUser | null = await User.findOne({
    messageApp: "Telegram",
    chatId: chatIdTg.toString()
  }).lean();
  if (isAxiosError(error)) {
    const tgError = error as AxiosError<TelegramAPIError>;

    switch (tgError.response?.data.description) {
      case "Forbidden: bot was blocked by the user": {
        if (user?.status === "active") {
          await User.updateOne(
            { messageApp: "Telegram", chatId: chatIdTg.toString() },
            { $set: { status: "blocked" } }
          );
          await umami.logAsync({
            event: "/user-blocked-joel",
            messageApp: "Telegram"
          });
        }
        return false;
      }
      case "Forbidden: user is deactivated":
        await umami.logAsync({
          event: "/user-deactivated",
          messageApp: "Telegram"
        });
        await deleteUserAndCleanup("Telegram", chatIdTg.toString());
        return false;
      case "Too many requests":
        if (retryParameters != null) {
          if (retryParameters.retryNumber > MAX_MESSAGE_RETRY) {
            await umamiLogger({
              event: "/message-fail-too-many-requests-aborted",
              messageApp: "Telegram"
            });
            return false;
          }
          await umamiLogger({
            event: "/message-fail-too-many-requests",
            messageApp: "Telegram"
          });
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, retryParameters.retryNumber) * 1000)
          );
          return await retryParameters.retryFunction(
            retryParameters.retryNumber + 1
          );
        } else {
          await logError(
            "Telegram",
            `Telegram API rate limit error in ${callerFunctionLabel}, but no retry parameters provided`
          );
          return false;
        }
    }
  }

  await logError(
    "Telegram",
    `Error in sending ${callerFunctionLabel} to ${String(chatIdTg)}`,
    error
  );
  return false;
}
