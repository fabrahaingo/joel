import { ButtonElement, ISession, IUser, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import { loadUser } from "./Session.ts";
import umami from "../utils/umami.ts";
import { splitText } from "../utils/text.utils.ts";
import { SignalCli } from "signal-sdk";
import emojiRegex from "emoji-regex";
import { ErrorMessages } from "./ErrorMessages.ts";

const SignalMessageApp: MessageApp = "Signal";

export class SignalSession implements ISession {
  messageApp = SignalMessageApp;
  signalCli: SignalCli;
  language_code: string;
  chatId: number;
  botPhoneID: string;
  user: IUser | null | undefined = undefined;
  isReply: boolean | undefined;
  mainMenuKeyboard: ButtonElement[][];

  log = umami.log;

  constructor(
    signalCli: SignalCli,
    botPhoneID: string,
    userPhoneId: string,
    language_code: string
  ) {
    this.signalCli = signalCli;
    this.botPhoneID = botPhoneID;
    this.chatId = parseInt(userPhoneId);
    this.language_code = language_code;
    this.mainMenuKeyboard = [];
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
    const mArr = splitText(cleanMessageForSignal(formattedData), 3000);

    for (const elem of mArr) {
      await this.signalCli.sendMessage(this.chatId.toString(), elem);
    }
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
        `Cette fonctionnalité n'est pas encore disponible sur ${session.messageApp}`,
        session.mainMenuKeyboard
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

function cleanMessageForSignal(msg: string): string {
  // text-utils.ts
  /**
   * Remove every accent/diacritic and return plain ASCII letters.
   * @example
   *   deburr("À bientôt, garçon! — Ça va?")  // "A bientot, garcon! — Ca va?"
   */
  function deburr(input: string): string {
    // 1. Use canonical decomposition (NFD) so "é" → "e\u0301"
    const decomposed = input.normalize("NFD");

    // 2. Strip all combining diacritical marks (U+0300–036F)
    const stripped = decomposed.replace(
      /\s[\u0300-\u036f]|[\u0300-\u036f]/gu,
      ""
    );

    // 3. Map remaining special-case runes that don’t decompose nicely
    return stripped
      .replace(/ß/g, "ss")
      .replace(/Æ/g, "AE")
      .replace(/æ/g, "ae")
      .replace(/Ø/g, "O")
      .replace(/ø/g, "o")
      .replace(/Ð/g, "D")
      .replace(/ð/g, "d")
      .replace(/Þ/g, "Th")
      .replace(/þ/g, "th")
      .replace(/Œ/g, "OE")
      .replace(/œ/g, "oe");
  }

  const emoteFreeText = msg.replace(emojiRegex(), "");

  const formattingFreeText = emoteFreeText.replace(/[_*🗓]/g, "");

  const accentFreeText = deburr(formattingFreeText);

  return accentFreeText;
}

const { WHATSAPP_PHONE_ID } = process.env;

export async function sendSignalAppMessage(
  signalCli: SignalCli,
  userPhoneId: string,
  message: string
) {
  if (WHATSAPP_PHONE_ID === undefined) {
    throw new Error(ErrorMessages.WHATSAPP_ENV_NOT_SET);
  }
  try {
    await signalCli.sendMessage(userPhoneId, message);
  } catch (error) {
    console.log(error);
  }
}
