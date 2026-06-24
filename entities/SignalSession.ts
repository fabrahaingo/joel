import { ISession, IUser, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import {
  ExternalMessageOptions,
  loadUser,
  MessageSendingOptionsInternal,
  recordSuccessfulDelivery
} from "./Session.ts";
import umami, { UmamiEvent, UmamiLogger } from "../utils/umami.ts";
import { markdown2plainText, splitText } from "../utils/text.utils.ts";
import { SignalCli } from "signal-sdk";
import { logError } from "../utils/debugLogger.ts";
import { KEYBOARD_KEYS, POLL_MENU_KEYS } from "./Keyboard.ts";
import { registerPollMenu } from "./SignalPollRegistry.ts";

const SignalMessageApp: MessageApp = "Signal";

export const SIGNAL_MESSAGE_CHAR_LIMIT = 2000;
const SIGNAL_COOL_DOWN_DELAY_SECONDS = 6;

export const SIGNAL_API_SENDING_CONCURRENCY = 1;

// Render menus as native Signal polls (analog to Matrix). Disable with
// SIGNAL_USE_POLLS=false to keep the plain-text menu instead.
const SIGNAL_USE_POLLS = process.env.SIGNAL_USE_POLLS !== "false";

// Signal poll constraints (signal-cli): 2–10 options, each 1–100 characters.
const SIGNAL_POLL_MAX_OPTIONS = 10;
const SIGNAL_POLL_OPTION_MAX_CHARS = 100;
const SIGNAL_POLL_MENU_TITLE = KEYBOARD_KEYS.MAIN_MENU.key.text;

export class SignalSession implements ISession {
  messageApp = SignalMessageApp;
  signalCli: SignalCli;
  language_code: string;
  chatId: string;
  botPhoneID: string;
  user: IUser | null | undefined = undefined;
  isReply: boolean | undefined;
  lastEngagementAt: Date;

  constructor(
    signalCli: SignalCli,
    botPhoneID: string,
    userPhoneId: string,
    language_code: string,
    lastEngagementAt: Date
  ) {
    this.signalCli = signalCli;
    this.botPhoneID = botPhoneID;
    this.chatId = userPhoneId;
    this.language_code = language_code;
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
    // Best-effort typing indicator; never block or throw on failure.
    void this.signalCli
      .sendTyping(toSignalRecipient(this.chatId))
      .catch(() => undefined);
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
    return await sendSignalAppMessage(
      this.signalCli,
      this.chatId,
      formattedData,
      { ...options, useAsyncUmamiLog: false, hasAccount: this.user != null }
    );
  }

  extractMessageAppsOptions(): ExternalMessageOptions {
    return { signalCli: this.signalCli };
  }
}

export async function extractSignalAppSession(
  session: ISession,
  userFacingError?: boolean
): Promise<SignalSession | undefined> {
  if (session.messageApp !== "Signal") {
    await logError(session.messageApp, "Session is not a SignalSession");
    if (userFacingError) {
      await session.sendMessage(
        `Cette fonctionnalité n'est pas encore disponible sur ${session.messageApp}`
      );
    }
    return undefined;
  }
  if (!(session instanceof SignalSession)) {
    await logError(
      session.messageApp,
      "Session messageApp is Signal, but session is not a SignalSession"
    );
    return undefined;
  }

  return session;
}

/** Ensure a Signal recipient is in +E.164 form. */
export function toSignalRecipient(phone: string): string {
  return phone.startsWith("+") ? phone : "+" + phone;
}

export async function sendSignalAppMessage(
  signalCli: SignalCli,
  userPhoneId: string,
  message: string,
  options: MessageSendingOptionsInternal
): Promise<boolean> {
  const umamiLogger: UmamiLogger = options.useAsyncUmamiLog
    ? umami.logAsync
    : umami.log;
  try {
    const cleanMessage = markdown2plainText(message);
    const userPhoneIdInt = toSignalRecipient(userPhoneId);
    const mArr = splitText(cleanMessage, SIGNAL_MESSAGE_CHAR_LIMIT);
    for (const elem of mArr) {
      await signalCli.sendMessage(userPhoneIdInt, elem);

      await umamiLogger({
        event: "/message-sent",
        messageApp: "Signal",
        hasAccount: options.hasAccount
      });

      // prevent hitting the Signal API rate limit
      await new Promise((resolve) =>
        setTimeout(resolve, SIGNAL_COOL_DOWN_DELAY_SECONDS * 1000)
      );
    }

    // Render the menu as a poll (analog to Matrix).
    if (options.separateMenuMessage) {
      // Main menu: the message body already carries a text-command menu, so a
      // poll only adds tap-to-navigate buttons. If it fails, the body stands.
      if (SIGNAL_USE_POLLS)
        await sendSignalPollMenu(
          signalCli,
          userPhoneIdInt,
          SIGNAL_POLL_MENU_TITLE,
          POLL_MENU_KEYS.map((k) => k.text),
          options.hasAccount
        );
    } else if (options.keyboard != null) {
      // Sub-menu: render the keyboard as a poll, else a plain-text option list.
      const optionTexts = options.keyboard.flat().map((k) => k.text);
      if (optionTexts.length >= 2) {
        const pollSent =
          SIGNAL_USE_POLLS &&
          (await sendSignalPollMenu(
            signalCli,
            userPhoneIdInt,
            SIGNAL_POLL_MENU_TITLE,
            optionTexts,
            options.hasAccount
          ));
        if (!pollSent)
          await sendSignalMenuFallbackText(
            signalCli,
            userPhoneIdInt,
            optionTexts
          );
      }
    }

    await recordSuccessfulDelivery(SignalMessageApp, userPhoneId);
  } catch (error) {
    await logError("Signal", "Error sending signal message", error);
    return false;
  }
  return true;
}

/**
 * Send a menu as a native Signal poll and remember its options so an incoming
 * vote can be mapped back to a menu action. Returns false on failure so the
 * caller can fall back to a text menu.
 */
export async function sendSignalPollMenu(
  signalCli: SignalCli,
  userPhoneId: string,
  title: string,
  optionTexts: string[],
  hasAccount?: boolean
): Promise<boolean> {
  try {
    const options = optionTexts
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, SIGNAL_POLL_MAX_OPTIONS)
      .map((t) =>
        t.length > SIGNAL_POLL_OPTION_MAX_CHARS
          ? t.slice(0, SIGNAL_POLL_OPTION_MAX_CHARS)
          : t
      );

    // Signal polls require at least 2 options.
    if (options.length < 2) return false;

    const res = await signalCli.sendPollCreate({
      question: title,
      options,
      multiSelect: false,
      recipients: [toSignalRecipient(userPhoneId)]
    });

    // Map this poll's send timestamp to the exact options we sent.
    registerPollMenu(res.timestamp, options);

    umami.log({
      event: "/message-sent",
      messageApp: "Signal",
      hasAccount
    });

    return true;
  } catch (error) {
    await logError("Signal", "Error sending signal poll menu", error);
    return false;
  }
}

/** Plain-text menu fallback when a poll cannot be sent. */
async function sendSignalMenuFallbackText(
  signalCli: SignalCli,
  userPhoneId: string,
  optionTexts: string[]
): Promise<void> {
  const body =
    "Choisissez une option en recopiant l'un des boutons ci-dessous:\n\n" +
    optionTexts.join("\n");
  await signalCli.sendMessage(toSignalRecipient(userPhoneId), body);
}
