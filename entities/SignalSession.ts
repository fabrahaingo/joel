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

const SignalMessageApp: MessageApp = "Signal";

export const SIGNAL_MESSAGE_CHAR_LIMIT = 2000;
const SIGNAL_COOL_DOWN_DELAY_SECONDS = 6;

export const SIGNAL_API_SENDING_CONCURRENCY = 1;

export class SignalSession implements ISession {
  messageApp = SignalMessageApp;
  signalCli: SignalCli;
  language_code: string;
  chatId: string;
  botPhoneID: string;
  user: IUser | null | undefined = undefined;
  isReply: boolean | undefined;

  constructor(
    signalCli: SignalCli,
    botPhoneID: string,
    userPhoneId: string,
    language_code: string
  ) {
    this.signalCli = signalCli;
    this.botPhoneID = botPhoneID;
    this.chatId = userPhoneId;
    this.language_code = language_code;
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
    // TODO: check implementation in Signal
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
    const userPhoneIdInt = userPhoneId.startsWith("+")
      ? userPhoneId
      : "+" + userPhoneId;
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
    await recordSuccessfulDelivery(SignalMessageApp, userPhoneId);
  } catch (error) {
    await logError("Signal", "Error sending signal message", error);
    return false;
  }
  return true;
}
