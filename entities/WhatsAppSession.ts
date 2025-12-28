import { ISession, IUser, MessageApp, NotificationType } from "../types.ts";
import User from "../models/User.ts";
import {
  ExtendedMiniUserInfo,
  ExternalMessageOptions,
  loadUser,
  messageReceivedTimeHistory,
  MessageSendingOptionsInternal,
  recordSuccessfulDelivery
} from "./Session.ts";
import umami, { UmamiEvent, UmamiLogger } from "../utils/umami.ts";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { ServerMessageResponse } from "whatsapp-api-js/types";
import {
  ActionButtons,
  ActionList,
  Body,
  Button,
  Interactive,
  ListSection,
  Row,
  Template,
  Text
} from "whatsapp-api-js/messages";
import { markdown2WHMarkdown, splitText } from "../utils/text.utils.ts";
import { deleteUserAndCleanup } from "../utils/userDeletion.utils.ts";
import { Keyboard, KEYBOARD_KEYS, KeyboardKey } from "./Keyboard.ts";
import { MAIN_MENU_MESSAGE } from "../commands/default.ts";
import { logError } from "../utils/debugLogger.ts";
import { timeDaysBetweenDates } from "../utils/date.utils.ts";

export const WHATSAPP_MESSAGE_CHAR_LIMIT = 900;
const WHATSAPP_COOL_DOWN_DELAY_SECONDS = 6; // 1 message every 6 seconds for the same user, but we'll take 1 here
const WHATSAPP_BURST_MODE_DELAY_SECONDS = 0.1; // Minimum delay between messages in burst mode

const WHATSAPP_BURST_MODE_THRESHOLD = 10; // Number of messages to send in burst mode, before switching to full cooldown

const MAX_MESSAGE_RETRY = 5;

export const WHATSAPP_API_SENDING_CONCURRENCY = 80; // 80 messages per second global

export const WHATSAPP_API_VERSION = "v24.0";

// MARGIN RELATIVE TO 24h REENGAGEMENT WINDOW
export const WHATSAPP_REENGAGEMENT_MARGIN_MINS = 5; // 5 mins

// 24h - MARGIN_MINS
export const WHATSAPP_REENGAGEMENT_TIMEOUT_WITH_MARGIN_MS =
  1000 * 60 * (24 * 60 - WHATSAPP_REENGAGEMENT_MARGIN_MINS);

// 24 h + 5*MARGIN_MINS (for near-miss calculations)
export const WHATSAPP_NEAR_MISS_WINDOW_MS =
  1000 * 60 * (24 * 60 + 5 * WHATSAPP_REENGAGEMENT_MARGIN_MINS);

const TEMPLATE_MESSAGE_COST_EUROS = 0.0248;

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
  lastEngagementAt: Date;

  constructor(
    whatsAppAPI: WhatsAppAPI,
    botPhoneID: string,
    userPhoneId: string,
    language_code: string,
    lastEngagementAt: Date
  ) {
    this.whatsAppAPI = whatsAppAPI;
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

  // Force to create a user record
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
      payload: args.payload,
      hasAccount: this.user != null
    });
  }

  async sendMessage(
    formattedData: string,
    options?: MessageSendingOptionsInternal
  ): Promise<boolean> {
    const hasAccount = this.user != null;
    return await sendWhatsAppMessage(
      this.whatsAppAPI,
      {
        messageApp: this.messageApp,
        chatId: this.chatId,
        lastEngagementAt: this.lastEngagementAt,
        waitingReengagement: false,
        status: "active",
        hasAccount
      },
      formattedData,
      { ...options, useAsyncUmamiLog: false, hasAccount }
    );
  }

  extractMessageAppsOptions(): ExternalMessageOptions {
    return { whatsAppAPI: this.whatsAppAPI };
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
  userInfo: ExtendedMiniUserInfo,
  message: string,
  options: MessageSendingOptionsInternal,
  retryNumber = 0
): Promise<boolean> {
  const now = new Date();
  if (
    now.getTime() - userInfo.lastEngagementAt.getTime() >
    WHATSAPP_REENGAGEMENT_TIMEOUT_WITH_MARGIN_MS
  ) {
    throw new Error(
      `Cannot send message to WH user ${userInfo.chatId} at time ${now.toISOString()}, as his lastEngagement is ${userInfo.lastEngagementAt.toISOString()} (margin is ${String(WHATSAPP_REENGAGEMENT_MARGIN_MINS)}mins)`
    );
  }

  const umamiLogger: UmamiLogger = options.useAsyncUmamiLog
    ? umami.logAsync
    : umami.log;

  if (WHATSAPP_PHONE_ID === undefined) {
    throw new Error(
      "WHATSAPP_PHONE_ID is not set. Send a message to the bot to fetch the expected value and define it."
    );
  }

  if (options.separateMenuMessage) options.forceNoKeyboard = true;

  let interactiveKeyboard: ActionList | ActionButtons | null = null;

  if (
    (options.keyboard == null && !options.forceNoKeyboard) ||
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
        !options.separateMenuMessage
      ) {
        if (interactiveKeyboard instanceof ActionButtons) {
          resp = await whatsAppAPI.sendMessage(
            WHATSAPP_PHONE_ID,
            userInfo.chatId,
            new Interactive(interactiveKeyboard, new Body(mArr[i]))
          );
        } else {
          resp = await whatsAppAPI.sendMessage(
            WHATSAPP_PHONE_ID,
            userInfo.chatId,
            new Interactive(interactiveKeyboard, new Body(mArr[i]))
          );
        }
      } else {
        resp = await whatsAppAPI.sendMessage(
          WHATSAPP_PHONE_ID,
          userInfo.chatId,
          new Text(mArr[i])
        );
      }
      if (resp.error) {
        const retryFunction = (nextRetryNumber: number) =>
          sendWhatsAppMessage(
            whatsAppAPI,
            userInfo,
            message,
            options,
            nextRetryNumber
          );
        return await handleWhatsAppAPIErrors(
          { errorCode: resp.error.code, rawError: resp.error },
          "sendWhatsAppMessage",
          userInfo.chatId,
          umamiLogger,
          { retryFunction, retryNumber }
        );
      }
      await umamiLogger({
        event: "/message-sent",
        messageApp: "WhatsApp",
        hasAccount: options.hasAccount
      });

      if (burstMode || (i == mArr.length - 1 && options.separateMenuMessage)) {
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

    if (options.separateMenuMessage && interactiveKeyboard != null) {
      if (interactiveKeyboard instanceof ActionButtons) {
        resp = await whatsAppAPI.sendMessage(
          WHATSAPP_PHONE_ID,
          userInfo.chatId,
          new Interactive(interactiveKeyboard, new Body(MAIN_MENU_MESSAGE))
        );
      } else {
        resp = await whatsAppAPI.sendMessage(
          WHATSAPP_PHONE_ID,
          userInfo.chatId,
          new Interactive(interactiveKeyboard, new Body(MAIN_MENU_MESSAGE))
        );
      }
      if (resp.error) {
        await logError("WhatsApp", "Error sending WH message", resp.error);
        return false;
      }
      numberMessageBurst += 1;
      await umamiLogger({
        event: "/message-sent",
        messageApp: "WhatsApp",
        hasAccount: options.hasAccount
      });
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
  await recordSuccessfulDelivery(WhatsAppMessageApp, userInfo.chatId);
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

const NOTIFICATION_TEMPLATE = "notification_meta";

export async function sendWhatsAppTemplate(
  whatsAppAPI: WhatsAppAPI,
  userInfo: ExtendedMiniUserInfo,
  notificationType: NotificationType,
  options: MessageSendingOptionsInternal,
  retryNumber = 0
): Promise<boolean> {
  const now = new Date();
  if (
    now.getTime() - userInfo.lastEngagementAt.getTime() <
    WHATSAPP_REENGAGEMENT_TIMEOUT_WITH_MARGIN_MS
  ) {
    await logError(
      "WhatsApp",
      `Sent template to non reengagement user ${userInfo.chatId}, last active on ${userInfo.lastEngagementAt.toISOString()}`
    );
  }

  const umamiLogger: UmamiLogger = options.useAsyncUmamiLog
    ? umami.logAsync
    : umami.log;

  if (WHATSAPP_PHONE_ID === undefined) {
    throw new Error(
      "WHATSAPP_PHONE_ID is not set. Send a message to the bot to fetch the expected value and define it."
    );
  }

  try {
    const template_message = new Template(NOTIFICATION_TEMPLATE, "fr");

    const resp: ServerMessageResponse = await whatsAppAPI.sendMessage(
      WHATSAPP_PHONE_ID,
      userInfo.chatId,
      template_message
    );

    if (resp.error) {
      const retryFunction = (nextRetryNumber: number) =>
        sendWhatsAppTemplate(
          whatsAppAPI,
          userInfo,
          notificationType,
          options,
          nextRetryNumber
        );
      return await handleWhatsAppAPIErrors(
        { errorCode: resp.error.code, rawError: resp.error },
        "sendWhatsAppTemplate",
        userInfo.chatId,
        umamiLogger,
        { retryFunction, retryNumber }
      );
    }

    const costOperation: IUser["costHistory"][number] = {
      operationDate: new Date(),
      operationType: `notification_${notificationType}`,
      cost: TEMPLATE_MESSAGE_COST_EUROS
    };
    await User.updateOne(
      { messageApp: "WhatsApp", chatId: userInfo.chatId },
      { $push: { costHistory: costOperation } }
    );

    await umamiLogger({
      event: "/reengagement-notifications-sent",
      messageApp: "WhatsApp",
      hasAccount: options.hasAccount,
      payload: {
        last_engagement_delay_days: timeDaysBetweenDates(
          userInfo.lastEngagementAt,
          new Date()
        ),
        triggered_by: notificationType
      }
    });

    await new Promise((resolve) =>
      setTimeout(resolve, WHATSAPP_COOL_DOWN_DELAY_SECONDS * 1000)
    );
    await recordSuccessfulDelivery(WhatsAppMessageApp, userInfo.chatId);
  } catch (error) {
    await logError("WhatsApp", "Error sending WH template", error);
    return false;
  }

  return true;
}

export async function handleWhatsAppAPIErrors(
  error: { errorCode: number; rawError?: unknown },
  callerFunctionLabel: string,
  chatId: string,
  umamiLogger: UmamiLogger,
  retryParameters?: {
    retryFunction: (retryNumber: number) => Promise<boolean>;
    retryNumber: number;
  }
): Promise<boolean> {
  const user: IUser | null = await User.findOne({
    messageApp: "WhatsApp",
    chatId: chatId
  }).lean();
  switch (error.errorCode) {
    // If rate limit exceeded, retry after 4^(numberRetry) seconds
    case 4:
    case 80007:
    case 130429:
    case 131048:
    case 131056:
      if (retryParameters != null) {
        if (retryParameters.retryNumber > MAX_MESSAGE_RETRY) {
          await umamiLogger({
            event: "/message-fail-too-many-requests-aborted",
            messageApp: "WhatsApp"
          });
          return false;
        }
        await umamiLogger({
          event: "/message-fail-too-many-requests",
          messageApp: "WhatsApp"
        });
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(4, retryParameters.retryNumber) * 1000)
        );
        return await retryParameters.retryFunction(
          retryParameters.retryNumber + 1
        );
      } else {
        await logError(
          "WhatsApp",
          `WH API rate limit error in ${callerFunctionLabel}, but no retry parameters provided`
        );
        return false;
      }

    case 131008: {
      // user blocked the bot
      if (user?.status === "active") {
        await User.updateOne(
          { messageApp: "WhatsApp", chatId: chatId },
          { $set: { status: "blocked" } }
        );
        await umami.logAsync({
          event: "/user-blocked-joel",
          messageApp: "WhatsApp"
        });
      }
      return false;
    }
    case 131026: // user not on WhatsApp
    case 131030:
      await umami.logAsync({
        event: "/user-deactivated",
        messageApp: "WhatsApp"
      });
      await deleteUserAndCleanup("WhatsApp", chatId);
      return false;
    case 131047: {
      // re-engagement expired : only triggered from the external on.status. WH API workflow
      let errorMsg = `WH API reengagement expired for ${chatId}.`;
      const now = new Date();
      const user: IUser | null = await User.findOne({
        messageApp: "WhatsApp",
        chatId: chatId
      }).lean();
      if (user == null) {
        errorMsg +=
          "\nCouldn't find an associated user record in the database.";
      } else {
        // The message sending time is the recorded last received message (despite being unsuccessful)
        const delaySentMessageSeconds = Math.floor(
          (user.lastMessageReceivedAt.getTime() -
            user.lastEngagementAt.getTime()) /
            1000
        );
        const delayNowSeconds = Math.floor(
          (now.getTime() - user.lastEngagementAt.getTime()) / 1000
        );
        errorMsg += `\nUser was last active on ${user.lastEngagementAt.toISOString()}
Last recorded message sent at ${user.lastMessageReceivedAt.toISOString()}: difference is ${String(delaySentMessageSeconds)}secs.
Current time is ${now.toISOString()}: difference is ${String(delayNowSeconds)}secs.
Current WH window margin is ${String(WHATSAPP_REENGAGEMENT_MARGIN_MINS * 60)}secs)`;

        // restore previous lastReceivedAt:
        const previousMessageReceivedTimeHistory =
          messageReceivedTimeHistory.get(`WhatsApp:${chatId}`);
        if (previousMessageReceivedTimeHistory == null) {
          errorMsg += `\nCouldn't retrieve previous lastMessageReceivedAt for ${chatId}`;
          await logError("WhatsApp", errorMsg);
          return false;
        }
        await User.updateOne(
          { messageApp: "WhatsApp", chatId },
          {
            $set: { lastMessageReceivedAt: previousMessageReceivedTimeHistory }
          }
        );
      }
      await logError("WhatsApp", errorMsg, error);
      return false;
    }
  }
  await logError(
    "WhatsApp",
    `WH API error ${String(error.errorCode)} in ${callerFunctionLabel} to ${chatId}`,
    error.rawError ?? undefined
  );
  return false;
}
