import { ISession, IUser, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import { loadUser } from "./Session.ts";
import umami from "../utils/umami.ts";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { ServerMessageResponse } from "whatsapp-api-js/types";
import { ErrorMessages } from "./ErrorMessages.ts";
import {
  ActionButtons,
  Body,
  Button,
  Interactive,
  Text
} from "whatsapp-api-js/messages";
import { markdown2WHMarkdown, splitText } from "../utils/text.utils.ts";
import { Keyboard, KEYBOARD_KEYS } from "./Keyboard.ts";

export const WHATSAPP_API_VERSION = "v23.0";

const WHATSAPP_MESSAGE_CHAR_LIMIT = 1023;
const WHATSAPP_COOL_DOWN_DELAY_SECONDS = 6; // 1 message every 6 seconds for the same user, but we'll take 1 here

export const WHATSAPP_API_SENDING_CONCURRENCY = 80; // 80 messages per second global

const WhatsAppMessageApp: MessageApp = "WhatsApp";

const mainMenuKeyboardWH: Keyboard = [[KEYBOARD_KEYS.COMMAND_LIST.key]];

export class WhatsAppSession implements ISession {
  messageApp = WhatsAppMessageApp;
  whatsAppAPI: WhatsAppAPI;
  language_code: string;
  chatId: string;
  botPhoneID: string;
  user: IUser | null | undefined = undefined;
  isReply: boolean | undefined;
  mainMenuKeyboard: Keyboard;

  log = umami.log;

  constructor(
    whatsAppAPI: WhatsAppAPI,
    botPhoneID: string,
    userPhoneId: string,
    language_code: string
  ) {
    this.whatsAppAPI = whatsAppAPI;
    this.botPhoneID = botPhoneID;
    this.chatId = userPhoneId;
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

  async sendMessage(formattedData: string, keyboard?: Keyboard): Promise<void> {
    await sendWhatsAppMessage(
      this.whatsAppAPI,
      this.chatId,
      formattedData,
      keyboard
    );
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
        `Cette fonctionnalité n'est pas encore disponible sur ${session.messageApp}`
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

export async function sendWhatsAppMessage(
  whatsAppAPI: WhatsAppAPI,
  userPhoneId: string,
  message: string,
  keyboard?: Keyboard,
  retryNumber = 0
): Promise<boolean> {
  if (retryNumber > 5) {
    await umami.log({ event: "/whatsapp-too-many-requests-aborted" });
    return false;
  } // give up after 5 retries

  if (WHATSAPP_PHONE_ID === undefined) {
    throw new Error(ErrorMessages.WHATSAPP_ENV_NOT_SET);
  }

  keyboard ??= mainMenuKeyboardWH;

  const keyboardFlat = keyboard?.flat();
  if (keyboardFlat != null) {
    if (keyboardFlat.length > 3) {
      console.log(
        `WhatsApp keyboard length is ${String(keyboardFlat.length)}>3`
      );
      return false;
    }
    for (const key of keyboardFlat) {
      if (key.text.length > 20) {
        console.log(`WhatsApp keyboard text too long, aborting: ${key.text}`);
        return false;
      }
    }
  }

  let resp: ServerMessageResponse;
  try {
    const mArr = splitText(
      markdown2WHMarkdown(message),
      WHATSAPP_MESSAGE_CHAR_LIMIT
    );
    for (let i = 0; i < mArr.length; i++) {
      if (i == mArr.length - 1 && keyboardFlat != null) {
        const buttons = keyboardFlat.map(
          (u, idx) => new Button(`reply_${String(idx)}`, u.text)
        );
        const actionList: Interactive = new Interactive(
          // @ts-expect-error the row spreader is correctly cast but not detected by ESLINT
          new ActionButtons(...buttons),
          new Body(mArr[i])
        );
        resp = await whatsAppAPI.sendMessage(
          WHATSAPP_PHONE_ID,
          userPhoneId,
          actionList
        );
      } else {
        resp = await whatsAppAPI.sendMessage(
          WHATSAPP_PHONE_ID,
          userPhoneId,
          new Text(mArr[i])
        );
      }
      if (resp.error) {
        switch (resp.error.code) {
          // If rate limit exceeded, retry after 4^(numberRetry) seconds
          case 4:
          case 80007:
          case 130429:
          case 131048:
          case 131056:
            await umami.log({ event: "/whatsapp-too-many-requests" });
            await new Promise((resolve) =>
              setTimeout(resolve, Math.pow(4, retryNumber) * 1000)
            );
            return await sendWhatsAppMessage(
              whatsAppAPI,
              userPhoneId,
              mArr.slice(i).join("\n"),
              keyboard,
              retryNumber + 1
            );

          case 131008: // user blocked the bot
            await umami.log({ event: "/user-blocked-joel" });
            await User.updateOne(
              { messageApp: "WhatsApp", chatId: userPhoneId },
              { $set: { status: "blocked" } }
            );
            break;
          case 131026: // user not on WhatsApp
          case 131030:
            await umami.log({ event: "/user-deactivated" });
            await User.deleteOne({
              messageApp: "WhatsApp",
              chatId: userPhoneId
            });
            break;
          default:
            console.log(resp.error);
        }
        return false;
      }
      await umami.log({ event: "/message-sent-whatsapp" });

      // prevent hitting the WH API rate limit
      await new Promise((resolve) =>
        setTimeout(resolve, WHATSAPP_COOL_DOWN_DELAY_SECONDS * 1000)
      );
    }
    if (mArr.length > 20)
      // If a very long message, we wait the equivalent of (6s-1s)/message
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          mArr.length * (WHATSAPP_COOL_DOWN_DELAY_SECONDS - 1) * 1000
        )
      );
  } catch (error) {
    console.log(error);
    return false;
  }
  return true;
}
