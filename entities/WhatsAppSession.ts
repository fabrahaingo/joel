import { ISession, IUser, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import {
  loadUser,
  MessageSendingOptionsInternal,
  recordSuccessfulDelivery
} from "./Session.ts";
import umami, { UmamiEvent, UmamiLogger } from "../utils/umami.ts";
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
import { deleteUserAndCleanupByIdentifier } from "../utils/userDeletion.utils.ts";
import { Keyboard, KEYBOARD_KEYS, KeyboardKey } from "./Keyboard.ts";
import { MAIN_MENU_MESSAGE } from "../commands/default.ts";
import { logError } from "../utils/debugLogger.ts";

export const WHATSAPP_MESSAGE_CHAR_LIMIT = 900;
const WHATSAPP_COOL_DOWN_DELAY_SECONDS = 6; // 1 message every 6 seconds for the same user, but we'll take 1 here
const WHATSAPP_BURST_MODE_DELAY_SECONDS = 0.1; // Minimum delay between messages in burst mode

const WHATSAPP_BURST_MODE_THRESHOLD = 10; // Number of messages to send in burst mode, before switching to full cooldown

export const WHATSAPP_API_SENDING_CONCURRENCY = 80; // 80 messages per second global

export const WHATSAPP_API_VERSION = "v24.0";

const WhatsAppMessageApp: MessageApp = "WhatsApp";

const fullMenuKeyboard: ActionList = new ActionList(
  "Menu principal",
  new ListSection(
    "Recherches",
    new Row(
      "opt_1",
      KEYBOARD_KEYS.TEXT_SEARCH.key.text,
      "Rechercher ou suivre un texte au JORF/BO."
    ),
    new Row(
      "opt_2",
      KEYBOARD_KEYS.PEOPLE_SEARCH.key.text,
      "Rechercher une personne au JORF/BO. Suivre à partir d'un texte."
    ),
    new Row(
      "opt_3",
      KEYBOARD_KEYS.FUNCTION_FOLLOW.key.text,
      "Suivre une fonction (ambassadeur, préfet ...)."
    ),
    new Row(
      "opt_4",
      KEYBOARD_KEYS.ORGANISATION_FOLLOW.key.text,
      "Suivre une organisation (Conseil constitutionnel, Conseil d'Etat ...)."
    )
  ),
  new ListSection(
    "Ajout groupé",
    new Row(
      "opt_5",
      KEYBOARD_KEYS.ENA_INSP_PROMO_SEARCH_LONG_NO_KEYBOARD.key.text,
      "Suivre les élèves d'une promotion ENA ou INSP."
    )
  ),
  new ListSection(
    "Compte",
    new Row(
      "opt_7",
      KEYBOARD_KEYS.FOLLOWS_LIST.key.text,
      "Lister mes suivis. Supprimer un suivi."
    ),
    new Row("opt_8", KEYBOARD_KEYS.HELP.key.text, "Aide & Stats."),
    new Row(
      "opt_10",
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

  sendTypingAction() {
    // TODO: check implementation in WH
  }

  log(args: { event: UmamiEvent; payload?: Record<string, unknown> }) {
    umami.log({
      event: args.event,
      messageApp: this.messageApp,
      payload: args.payload
    });
  }

  async sendMessage(
    formattedData: string,
    options?: MessageSendingOptionsInternal
  ): Promise<boolean> {
    return await sendWhatsAppMessage(
      this.whatsAppAPI,
      this.chatId,
      formattedData,
      options
    );
  }
}

export async function extractWhatsAppSession(
  session: ISession,
  userFacingError?: boolean
): Promise<WhatsAppSession | undefined> {
  if (session.messageApp !== "WhatsApp") {
    await logError(
      session.messageApp,
      "Error extracting whatsapp session from session"
    );
    if (userFacingError) {
      await session.sendMessage(
        `Cette fonctionnalité n'est pas encore disponible sur ${session.messageApp}`
      );
    }
    return undefined;
  }
  if (!(session instanceof WhatsAppSession)) {
    await logError(
      session.messageApp,
      "Session messageApp is WhatsApp, but session is not a WhatsAppSession"
    );
    return undefined;
  }

  return session;
}

const { WHATSAPP_PHONE_ID } = process.env;

export async function sendWhatsAppMessage(
  whatsAppAPI: WhatsAppAPI,
  userPhoneIdStr: string,
  message: string,
  options?: MessageSendingOptionsInternal,
  retryNumber = 0
): Promise<boolean> {
  const umamiLogger: UmamiLogger =
    options?.useAsyncUmamiLog === true ? umami.logAsync : umami.log;
  if (retryNumber > 5) {
    umamiLogger({
      event: "/message-fail-too-many-requests-aborted",
      messageApp: "WhatsApp"
    });
    return false;
  } // give up after 5 retries

  if (WHATSAPP_PHONE_ID === undefined) {
    throw new Error(ErrorMessages.WHATSAPP_ENV_NOT_SET);
  }

  if (options?.separateMenuMessage) options.forceNoKeyboard = true;

  let interactiveKeyboard: ActionList | ActionButtons | null = null;

  if (
    (options?.keyboard == null && !options?.forceNoKeyboard) ||
    options.separateMenuMessage
  )
    interactiveKeyboard = fullMenuKeyboard;
  else if (options.keyboard != null) {
    const keyboardFlat = replaceWHButtons(options.keyboard).flat();
    if (keyboardFlat.length > 3) {
      await logError(
        "WhatsApp",
        `WhatsApp keyboard length for buttons is ${String(keyboardFlat.length)}>3 : ${keyboardFlat.map((k) => k.text).join(", ")}`
      );
      keyboardFlat.forEach((k) => {
        console.log(k.text);
      });
      return false;
    }
    for (const key of keyboardFlat) {
      if (key.text.length > 20) {
        await logError(
          "WhatsApp",
          `WhatsApp keyboard text too long, aborting: ${key.text}`
        );
        return false;
      }
    }
    const buttons = keyboardFlat.map(
      (u, idx) => new Button(`reply_${String(idx)}`, u.text)
    );
    // @ts-expect-error TypeScript does not account for the spread operator
    interactiveKeyboard = new ActionButtons(...buttons);
  }

  let resp: ServerMessageResponse;
  try {
    const mArr = splitText(
      markdown2WHMarkdown(message),
      WHATSAPP_MESSAGE_CHAR_LIMIT
    );

    const burstMode = mArr.length <= WHATSAPP_BURST_MODE_THRESHOLD; // Limit cooldown if less than 10

    for (let i = 0; i < mArr.length; i++) {
      if (
        i == mArr.length - 1 &&
        interactiveKeyboard != null &&
        !options?.separateMenuMessage
      ) {
        if (interactiveKeyboard instanceof ActionButtons) {
          resp = await whatsAppAPI.sendMessage(
            WHATSAPP_PHONE_ID,
            userPhoneIdStr,
            new Interactive(interactiveKeyboard, new Body(mArr[i]))
          );
        } else {
          resp = await whatsAppAPI.sendMessage(
            WHATSAPP_PHONE_ID,
            userPhoneIdStr,
            new Interactive(interactiveKeyboard, new Body(mArr[i]))
          );
        }
      } else {
        resp = await whatsAppAPI.sendMessage(
          WHATSAPP_PHONE_ID,
          userPhoneIdStr,
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
            umamiLogger({
              event: "/message-fail-too-many-requests",
              messageApp: "WhatsApp"
            });
            await new Promise((resolve) =>
              setTimeout(resolve, Math.pow(4, retryNumber) * 1000)
            );
            return await sendWhatsAppMessage(
              whatsAppAPI,
              userPhoneIdStr,
              mArr.slice(i).join("\n"),
              options,
              retryNumber + 1
            );

          case 131008: // user blocked the bot
            umamiLogger({
              event: "/user-blocked-joel",
              messageApp: "WhatsApp"
            });
            await User.updateOne(
              { messageApp: "WhatsApp", chatId: userPhoneIdStr },
              { $set: { status: "blocked" } }
            );
            break;
          case 131026: // user not on WhatsApp
          case 131030:
            umamiLogger({
              event: "/user-deactivated",
              messageApp: "WhatsApp"
            });
            await deleteUserAndCleanupByIdentifier("WhatsApp", userPhoneIdStr);
            break;
          default:
            await logError("WhatsApp", "Error sending WH message", resp.error);
        }
        return false;
      }
      umamiLogger({ event: "/message-sent", messageApp: "WhatsApp" });

      if (burstMode || (i == mArr.length - 1 && options?.separateMenuMessage)) {
        // prevent hitting the WH API rate limit
        await new Promise((resolve) =>
          setTimeout(resolve, WHATSAPP_BURST_MODE_DELAY_SECONDS * 1000)
        );
      } else {
        await new Promise((resolve) =>
          setTimeout(resolve, WHATSAPP_COOL_DOWN_DELAY_SECONDS * 1000)
        );
      }
    }
    let numberMessageBurst = burstMode ? mArr.length : 0;

    if (options?.separateMenuMessage && interactiveKeyboard != null) {
      if (interactiveKeyboard instanceof ActionButtons) {
        resp = await whatsAppAPI.sendMessage(
          WHATSAPP_PHONE_ID,
          userPhoneIdStr,
          new Interactive(interactiveKeyboard, new Body(MAIN_MENU_MESSAGE))
        );
      } else {
        resp = await whatsAppAPI.sendMessage(
          WHATSAPP_PHONE_ID,
          userPhoneIdStr,
          new Interactive(interactiveKeyboard, new Body(MAIN_MENU_MESSAGE))
        );
      }
      if (resp.error) {
        await logError("WhatsApp", "Error sending WH message", resp.error);
        return false;
      }
      numberMessageBurst += 1;
      umamiLogger({ event: "/message-sent", messageApp: "WhatsApp" });
    }

    // make up for the cooldown delay borrowed in the burst mode
    if (burstMode) {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          numberMessageBurst *
            (WHATSAPP_COOL_DOWN_DELAY_SECONDS -
              WHATSAPP_BURST_MODE_DELAY_SECONDS) *
            1000
        )
      );
    }
  } catch (error) {
    await logError("WhatsApp", "Error sending WH message", error);
    return false;
  }
  await recordSuccessfulDelivery(WhatsAppMessageApp, userPhoneIdStr);
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
