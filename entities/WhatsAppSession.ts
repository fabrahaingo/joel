import { ISession, IUser, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import { loadUser, recordSuccessfulDelivery } from "./Session.ts";
import umami from "../utils/umami.ts";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { ServerMessageResponse } from "whatsapp-api-js/types";
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
import { markdown2WHMarkdown, splitText } from "../utils/text.utils.ts";
import { Keyboard, KEYBOARD_KEYS, KeyboardKey } from "./Keyboard.ts";

export const WHATSAPP_API_VERSION = "v23.0";

const WHATSAPP_MESSAGE_CHAR_LIMIT = 1023;
const WHATSAPP_COOL_DOWN_DELAY_SECONDS = 6; // 1 message every 6 seconds for the same user, but we'll take 1 here

export const WHATSAPP_API_SENDING_CONCURRENCY = 80; // 80 messages per second global

const WhatsAppMessageApp: MessageApp = "WhatsApp";

const fullMenuKeyboard: ActionList = new ActionList(
  "Menu principal",
  new ListSection(
    "Recherches",
    new Row(
      "opt_1",
      KEYBOARD_KEYS.PEOPLE_SEARCH.key.text,
      "Rechercher une personne au JORF/BO."
    ),
    new Row(
      "opt_2",
      KEYBOARD_KEYS.FUNCTION_FOLLOW.key.text,
      "Suivre une fonction (ambassadeur, préfet ...)."
    ),
    new Row(
      "opt_4",
      KEYBOARD_KEYS.ORGANISATION_FOLLOW.key.text,
      "Suivre une organisation (Conseil constitutionnel, Conseil d'Etat ...)."
    ),
    new Row(
      "opt_5",
      KEYBOARD_KEYS.REFERENCE_FOLLOW.key.text,
      "Suivre à partir d'une référence JORF/BO. Ex: JORFTEXT000052184758"
    )
  ),
  new ListSection(
    "Mon compte", // optional if only 1 section; <= 24 chars
    new Row(
      "opt_6",
      KEYBOARD_KEYS.FOLLOWS_LIST.key.text,
      "Lister mes suivis. Supprimer un suivi."
    ),
    new Row("opt_7", KEYBOARD_KEYS.HELP.key.text, "Aide et contact."),
    new Row(
      "opt_8",
      KEYBOARD_KEYS.DELETE.key.text,
      "Supprimer mon compte et mes suivis."
    )
  )
);

export class WhatsAppSession implements ISession {
  messageApp = WhatsAppMessageApp;
  whatsAppAPI: WhatsAppAPI;
  language_code: string;
  chatId: string;
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
    // TODO: check implementation in WH
  }

  async sendMessage(
    formattedData: string,
    keyboard?: Keyboard,
    options?: {
      forceNoKeyboard?: boolean;
    }
  ): Promise<void> {
    await sendWhatsAppMessage(this.whatsAppAPI, this.chatId, formattedData, {
      keyboard,
      forceNoKeyboard: options?.forceNoKeyboard
    });
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
  options?: {
    keyboard?: Keyboard;
    forceNoKeyboard?: boolean;
  },
  retryNumber = 0
): Promise<boolean> {
  if (retryNumber > 5) {
    await umami.log({ event: "/whatsapp-too-many-requests-aborted" });
    return false;
  } // give up after 5 retries

  if (WHATSAPP_PHONE_ID === undefined) {
    throw new Error(ErrorMessages.WHATSAPP_ENV_NOT_SET);
  }

  let interactiveKeyboard: ActionList | ActionButtons | null = null;

  if (options?.keyboard == null && !options?.forceNoKeyboard)
    interactiveKeyboard = fullMenuKeyboard;
  else if (options.keyboard != null) {
    const keyboardFlat = replaceWHButtons(options.keyboard).flat();
    if (keyboardFlat.length > 3) {
      console.log(
        `WhatsApp keyboard length for buttons is ${String(keyboardFlat.length)}>3`
      );
      return false;
    }
    for (const key of keyboardFlat) {
      if (key.text.length > 20) {
        console.log(`WhatsApp keyboard text too long, aborting: ${key.text}`);
        return false;
      }
    }
    const buttons = keyboardFlat.map(
      (u, idx) => new Button(`reply_${String(idx)}`, u.text)
    );
    interactiveKeyboard = new ActionButtons(...buttons);
  }

  let resp: ServerMessageResponse;
  try {
    const mArr = splitText(
      markdown2WHMarkdown(message),
      WHATSAPP_MESSAGE_CHAR_LIMIT
    );
    for (let i = 0; i < mArr.length; i++) {
      if (i == mArr.length - 1 && interactiveKeyboard != null) {
        if (interactiveKeyboard instanceof ActionButtons) {
          resp = await whatsAppAPI.sendMessage(
            WHATSAPP_PHONE_ID,
            userPhoneId,
            new Interactive(interactiveKeyboard, new Body(mArr[i]))
          );
        } else {
          resp = await whatsAppAPI.sendMessage(
            WHATSAPP_PHONE_ID,
            userPhoneId,
            new Interactive(interactiveKeyboard, new Body(mArr[i]))
          );
        }
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
              options,
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
  } catch (error) {
    console.log(error);
    return false;
  }
  await recordSuccessfulDelivery(WhatsAppMessageApp, userPhoneId);
  return true;
}

function replaceWHButtons(keyboard: Keyboard): Keyboard {
  if (!Array.isArray(keyboard)) return keyboard;

  const replacements: Record<string, KeyboardKey> = {
    //[KEYBOARD_KEYS.MAIN_MENU.key.text]: KEYBOARD_KEYS.COMMAND_LIST.key,
  };

  return keyboard.map((row) =>
    row.map((k) => {
      const r = replacements[k.text];
      return r ? r : k;
    })
  );
}
