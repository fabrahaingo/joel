import { ISession, IUser, MessageApp } from "../types.js";
import User from "../models/User.js";
import { loadUser } from "./Session.js";
import umami from "../utils/umami.js";
import { splitText } from "../utils/text.utils.js";
import { mainMenuKeyboard } from "../utils/keyboards.js";
import { Text } from "whatsapp-api-js/messages";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";

const WhatsAppMessageApp: MessageApp = "WhatsApp";

export class WhatsAppSession implements ISession {
  messageApp = WhatsAppMessageApp;
  whatsAppAPI: WhatsAppAPI;
  language_code: string;
  chatId: number;
  botPhoneID: string;
  user: IUser | null | undefined = undefined;
  isReply: boolean | undefined;

  log = umami.log;

  constructor(
    whatsAppAPI: WhatsAppAPI,
    botPhoneID: string,
    userPhoneId: string,
    language_code: string
  ) {
    this.whatsAppAPI = whatsAppAPI;
    this.botPhoneID = botPhoneID;
    this.chatId = parseInt(userPhoneId);
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

  async sendMessage(
    this: WhatsAppSession,
    msg: string,
    keyboard?: { text: string }[][]
  ) {
    if (msg.length > 3000) {
      await this.sendLongMessage(msg);
      return;
    }
    const resp = await this.whatsAppAPI.sendMessage(
      this.botPhoneID,
      this.chatId.toString(),
      new Text(msg)
    );

    if (resp.error) {
      console.log(resp.error);
      throw new Error("Error sending WH message to user.");
    }
  }

  async sendTypingAction() {
    await Promise.resolve();
    // TODO: check implementation in WH
  }

  async sendLongMessage(
    formattedData: string,
    keyboard?: { text: string }[][]
  ): Promise<void> {
    const mArr = splitText(formattedData, 3000);

    for (let i = 0; i < mArr.length; i++) {
      await this.sendMessage(mArr[i]);
    }
  }
}

export async function extractWhatsAppSession(
  session: ISession,
  userFacingError?: boolean
): Promise<WhatsAppSession | undefined> {
  if (session.messageApp !== "WhatsApp") {
    console.log("Session is not a WhatsAppSession");
    if (userFacingError) {
      await session.sendMessage(
        `Cette fonctionnalité n'est pas encore disponible sur ${session.messageApp}`,
        mainMenuKeyboard
      );
    }
    return undefined;
  }
  if (!(session instanceof WhatsAppSession)) {
    console.log(
      "Session messageApp is WhatsApp, but session is not a WhatsAppSession"
    );
    return undefined;
  }

  return session;
}
