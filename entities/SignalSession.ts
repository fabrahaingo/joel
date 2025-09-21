import { ISession, IUser, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import { loadUser } from "./Session.ts";
import umami from "../utils/umami.ts";
import { markdown2plainText, splitText } from "../utils/text.utils.ts";
import { SignalCli } from "signal-sdk";

const SignalMessageApp: MessageApp = "Signal";

const SIGNAL_MESSAGE_CHAR_LIMIT = 2000;
const SIGNAL_COOL_DOWN_DELAY_SECONDS = 6;

export const SIGNAL_API_SENDING_CONCURRENCY = 1;

export class SignalSession implements ISession {
  messageApp = SignalMessageApp;
  signalCli: SignalCli;
  language_code: string;
  chatId: number;
  botPhoneID: string;
  user: IUser | null | undefined = undefined;
  isReply: boolean | undefined;

  log = umami.log;

  constructor(
    signalCli: SignalCli,
    botPhoneID: string,
    userPhoneId: number,
    language_code: string
  ) {
    this.signalCli = signalCli;
    this.botPhoneID = botPhoneID;
    this.chatId = userPhoneId;
    this.language_code = language_code;
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
    await Promise.resolve();
    // TODO: check implementation in Signal
  }

  async sendMessage(formattedData: string): Promise<void> {
    await sendSignalAppMessage(this.signalCli, this.chatId, formattedData);
  }
}

export async function extractSignalAppSession(
  session: ISession,
  userFacingError?: boolean
): Promise<SignalSession | undefined> {
  if (session.messageApp !== "Signal") {
    console.log("Session is not a SignalSession");
    if (userFacingError) {
      await session.sendMessage(
        `Cette fonctionnalité n'est pas encore disponible sur ${session.messageApp}`
      );
    }
    return undefined;
  }
  if (!(session instanceof SignalSession)) {
    console.log(
      "Session messageApp is Signal, but session is not a SignalSession"
    );
    return undefined;
  }

  return session;
}

export async function sendSignalAppMessage(
  signalCli: SignalCli,
  userPhoneId: number,
  message: string
): Promise<boolean> {
  try {
    const cleanMessage = markdown2plainText(message);
    const userPhoneIdInt = "+" + userPhoneId;
    const mArr = splitText(cleanMessage, SIGNAL_MESSAGE_CHAR_LIMIT);
    for (const elem of mArr) {
      await signalCli.sendMessage(userPhoneIdInt, elem);

      await umami.log({ event: "/message-sent-signal" });

      // prevent hitting the Signal API rate limit
      await new Promise((resolve) =>
        setTimeout(resolve, SIGNAL_COOL_DOWN_DELAY_SECONDS * 1000)
      );
    }
  } catch (error) {
    console.log(error);
    return false;
  }
  return true;
}
