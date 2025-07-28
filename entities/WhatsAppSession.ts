import {
  ButtonElement,
  ISession,
  IUser,
  KeyboardType,
  MessageApp
} from "../types.ts";
import User from "../models/User.ts";
import { loadUser } from "./Session.ts";
import umami from "../utils/umami.ts";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { ServerMessageResponse } from "whatsapp-api-js/types";
import { getWhatsAppAPI } from "../WhatsAppApp.ts";
import { ErrorMessages } from "./ErrorMessages.ts";
import {
  ActionButtons,
  ActionList,
  Body,
  Button,
  Interactive,
  ListSection,
  Row,
  Text
} from "whatsapp-api-js/messages";
import { splitText } from "../utils/text.utils.ts";

const WhatsAppMessageApp: MessageApp = "WhatsApp";

const mainMenuKeyboardWH: ButtonElement[][] = [
  [
    {
      text: "🔎 Rechercher"
    },
    { text: "👨‍💼 Ajout Fonction" },
    { text: "🏛️️ Ajout Organisation" },
    { text: "🧐 Mes suivis" },
    { text: "❓ Aide & Contact" }
  ]
];

export class WhatsAppSession implements ISession {
  messageApp = WhatsAppMessageApp;
  whatsAppAPI: WhatsAppAPI;
  language_code: string;
  chatId: number;
  botPhoneID: string;
  user: IUser | null | undefined = undefined;
  isReply: boolean | undefined;
  mainMenuKeyboard: ButtonElement[][];

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
    this.mainMenuKeyboard = mainMenuKeyboardWH;
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
    // TODO: check implementation in WH
  }

  async sendMessage(
    formattedData: string,
    keyboard?: { text: string }[][],
    menuType?: KeyboardType,
    listName?: string
  ): Promise<void> {
    const mArr = splitText(formattedData, 3000);

    let resp: ServerMessageResponse;

    for (let i = 0; i < mArr.length; i++) {
      if (keyboard == null || i < mArr.length - 1) {
        resp = await this.whatsAppAPI.sendMessage(
          this.botPhoneID,
          this.chatId.toString(),
          new Text(mArr[i])
        );
      } else {
        const keyboardFlat = keyboard.flat();
        let actionList: Interactive;

        if (menuType === "List" || keyboardFlat.length > 3) {
          const buttons = keyboardFlat.map(
            (u, idx) => new Row(`reply_${String(idx)}`, u.text)
          );
          actionList = new Interactive(
            new ActionList(
              listName ?? "Menu principal",
              // @ts-expect-error the row spreader is correctly cast but not detected by ESLINT
              new ListSection(undefined, ...buttons)
            ),
            new Body(formattedData)
          );
        } else {
          const buttons = keyboardFlat.map(
            (u, idx) => new Button(`reply_${String(idx)}`, u.text)
          );
          actionList = new Interactive(
            // @ts-expect-error the row spreader is correctly cast but not detected by ESLINT
            new ActionButtons(...buttons),
            new Body(formattedData)
          );
        }
        resp = await this.whatsAppAPI.sendMessage(
          this.botPhoneID,
          this.chatId.toString(),
          actionList
        );
      }
      if (resp.error) {
        console.log(resp.error);
        throw new Error("Error sending WH message to user.");
      }
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
        session.mainMenuKeyboard
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

const { WHATSAPP_PHONE_ID } = process.env;

const whatsAppAPI = getWhatsAppAPI();

export async function sendWhatsAppMessage(
  userPhoneId: number,
  message: string
) {
  if (WHATSAPP_PHONE_ID === undefined) {
    throw new Error(ErrorMessages.WHATSAPP_ENV_NOT_SET);
  }

  await whatsAppAPI.sendMessage(
    WHATSAPP_PHONE_ID,
    String(userPhoneId),
    new Text(message)
  );
}
