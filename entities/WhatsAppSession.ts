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
export const WHATSAPP_MAX_LINES = 18;
const WHATSAPP_COOL_DOWN_DELAY_SECONDS = 6; // 1 message every 6 seconds for the same user, but we'll take 1 here
const WHATSAPP_BURST_MODE_DELAY_SECONDS = 0.5; // Minimum delay between messages in burst mode to avoid per-user rate limits

const WHATSAPP_BURST_MODE_THRESHOLD = 10; // Number of messages to send in burst mode, before switching to full cooldown

const MAX_MESSAGE_RETRY = 5;
// Cap the exponential backoff so a single send can't hold a dispatch slot for
// minutes (4^5 = 1024s uncapped). Jitter de-syncs concurrent retries.
const MAX_BACKOFF_MS = 60_000;

export const WHATSAPP_API_SENDING_CONCURRENCY = 80; // 80 messages per second global

export const WHATSAPP_API_VERSION = "v24.0";

// MARGIN RELATIVE TO 24h REENGAGEMENT WINDOW
// Safety buffer before the real 24h limit: only needs to cover the
// snapshot->actual-send latency for an edge-first user plus WhatsApp API time.
// INVARIANT: margin >= max(windowNow snapshot -> actual send latency). The guard
// decides on the run-start snapshot; the real send happens up to one run-length
// later, so the margin must cover that gap to keep real sends < 24h (no WH error
// 131047). Keeping NOTIFICATIONS_SHIFT_DAYS small bounds the run length here.
export const WHATSAPP_REENGAGEMENT_MARGIN_MINS = 5; // 5 mins

// Per-day advance applied by the daily scheduler to keep a user who interacted
// yesterday inside their 24h window today (see notificationScheduler.ts). Kept
// separate from the cutoff margin above so each can be tuned independently:
// historically both were the same constant, which is why margin == step ==
// process-latency all read as "5 min". Keep >= margin so the chained window
// never closes before the next run.
export const WHATSAPP_SHIFT_STEP_MINS = 5; // 5 mins

// 24h - MARGIN_MINS
export const WHATSAPP_REENGAGEMENT_TIMEOUT_WITH_MARGIN_MS =
  1000 * 60 * (24 * 60 - WHATSAPP_REENGAGEMENT_MARGIN_MINS);

// 24 h + 5*MARGIN_MINS (for near-miss calculations)
export const WHATSAPP_NEAR_MISS_WINDOW_MS =
  1000 * 60 * (24 * 60 + 5 * WHATSAPP_REENGAGEMENT_MARGIN_MINS);

// Weekly re-engagement reminder for users with pending notifications.
// Resend the template at most once per interval, capped per pending cycle.
export const REENGAGEMENT_REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MAX_REENGAGEMENT_REMINDERS = 8;

// Hard ceiling on reminders sent per sweep run. Caps the cost/throughput spike
// when a large backlog of pending users all come due at once (e.g. first run
// after deploy); the rest roll over to the next daily sweep, oldest pending first.
export const REENGAGEMENT_MAX_SENDS_PER_SWEEP = 500;

export const TEMPLATE_MESSAGE_COST_EUROS = 0.0248;

const WhatsAppMessageApp: MessageApp = "WhatsApp";

const fullMenuKeyboard: ActionList = new ActionList(
  "Menu principal",
  new ListSection(
    "Recherches",
    new Row(
      "opt_1",
      KEYBOARD_KEYS.PEOPLE_SEARCH.key.text,
      "Rechercher une personne au JORF/BO. Suivre à partir d'un texte."
    ),
    new Row(
      "opt_2",
      KEYBOARD_KEYS.ORGANISATION_FOLLOW.key.text,
      "Suivre une organisation (Conseil constitutionnel, Conseil d'Etat ...)."
    ),
    new Row(
      "opt_3",
      KEYBOARD_KEYS.FUNCTION_FOLLOW.key.text,
      "Suivre une fonction (ambassadeur, préfet ...)."
    ),
    new Row(
      "opt_4",
      KEYBOARD_KEYS.TEXT_SEARCH.key.text,
      "Rechercher ou suivre une expression au JORF/BO."
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
  retryNumber = 0,
  // Resume state for retries: when a chunk send fails, the retry re-enters with
  // the already-split/already-converted chunks (preSplitChunks) and the index of
  // the failed chunk (startChunk), so previously delivered chunks are NOT resent.
  // Resending the whole message from chunk 0 duplicated delivered chunks and
  // amplified the pair rate limit (#131056). startChunk >= chunks.length skips the
  // chunk loop entirely and resumes at the separate menu message.
  preSplitChunks?: string[],
  startChunk = 0
): Promise<boolean> {
  // Judge the window against the run-wide snapshot when the notification path
  // supplies one, so this guard agrees with the routing decision the handler
  // already made on the same instant. Without it (interactive replies) fall back
  // to real time. Degrade, never throw: a thrown guard here is uncaught through
  // the dispatch Promise.all and aborts the entire run for every queued user.
  const now = options.windowNow ?? new Date();
  if (
    now.getTime() - userInfo.lastEngagementAt.getTime() >
    WHATSAPP_REENGAGEMENT_TIMEOUT_WITH_MARGIN_MS
  ) {
    await logError(
      "WhatsApp",
      `Skipped free message to WH user ${userInfo.chatId} at time ${now.toISOString()}, as his lastEngagement is ${userInfo.lastEngagementAt.toISOString()} (margin is ${String(WHATSAPP_REENGAGEMENT_MARGIN_MINS)}mins). User picked up by re-engagement next run/sweep.`
    );
    return false;
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
  // On a retry, reuse the chunks split on the first attempt. Re-splitting here
  // would re-run markdown2WHMarkdown on already-converted text (double conversion).
  const mArr =
    preSplitChunks ??
    splitText(
      markdown2WHMarkdown(message),
      WHATSAPP_MESSAGE_CHAR_LIMIT,
      WHATSAPP_MAX_LINES
    );

  const totalMessages = mArr.length + (options.separateMenuMessage ? 1 : 0);
  const burstMode = totalMessages <= WHATSAPP_BURST_MODE_THRESHOLD; // Limit cooldown if less than 10

  let i = startChunk;
  try {
    for (; i < mArr.length; i++) {
      if (
        i == mArr.length - 1 &&
        interactiveKeyboard != null &&
        !options.separateMenuMessage
      ) {
        resp = await whatsAppAPI.sendMessage(
          WHATSAPP_PHONE_ID,
          userInfo.chatId,
          new Interactive(interactiveKeyboard, new Body(mArr[i]))
        );
      } else {
        resp = await whatsAppAPI.sendMessage(
          WHATSAPP_PHONE_ID,
          userInfo.chatId,
          new Text(mArr[i])
        );
      }
      if (resp.error) {
        // Resume from the failed chunk i, reusing mArr (no re-split/re-convert).
        const failedChunk = i;
        const retryFunction = (nextRetryNumber: number) =>
          sendWhatsAppMessage(
            whatsAppAPI,
            userInfo,
            message,
            options,
            nextRetryNumber,
            mArr,
            failedChunk
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

      if (burstMode) {
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
    const numberMessageBurst = burstMode ? totalMessages : 0;

    if (options.separateMenuMessage && interactiveKeyboard != null) {
      resp = await whatsAppAPI.sendMessage(
        WHATSAPP_PHONE_ID,
        userInfo.chatId,
        new Interactive(interactiveKeyboard, new Body(MAIN_MENU_MESSAGE))
      );
      if (resp.error) {
        // The chunks already sent; resume at the separate menu (skip chunk loop)
        // by starting past the last chunk so we don't resend delivered chunks.
        const retryFunction = (nextRetryNumber: number) =>
          sendWhatsAppMessage(
            whatsAppAPI,
            userInfo,
            message,
            options,
            nextRetryNumber,
            mArr,
            mArr.length
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
    await logError(
      "WhatsApp",
      `Error sending WH message (${String(i + 1)}/${String(mArr.length)}, burstMode=${String(burstMode)}) to user ${userInfo.chatId}`,
      error
    );
    return false;
  }
  await recordSuccessfulDelivery(WhatsAppMessageApp, userInfo.chatId);
  return true;
}

function replaceWHButtons(keyboard: Keyboard): Keyboard {
  const replacements: Partial<Record<string, KeyboardKey>> = {
    // [KEYBOARD_KEYS.MAIN_MENU.key.text]: KEYBOARD_KEYS.COMMAND_LIST.key,
  };

  return keyboard.map((row) =>
    row.map((k) => {
      const r = replacements[k.text];
      return r ?? k;
    })
  );
}

export const NOTIFICATION_TEMPLATE = "notification_meta";

// Distinct "last nudge" template used on the final allowed reminder so the user
// knows it's the last one. Falls back to the standard template when no separate
// (approved) template is configured, preserving current behavior.
export const FINAL_NOTIFICATION_TEMPLATE =
  process.env.WHATSAPP_FINAL_NOTIFICATION_TEMPLATE ?? NOTIFICATION_TEMPLATE;

export async function sendWhatsAppTemplate(
  whatsAppAPI: WhatsAppAPI,
  userInfo: ExtendedMiniUserInfo,
  notificationType: NotificationType,
  options: MessageSendingOptionsInternal,
  templateName: string = NOTIFICATION_TEMPLATE,
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
    const template_message = new Template(templateName, "fr");

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
          templateName,
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
      {
        $push: { costHistory: costOperation },
        $set: { lastReengagementSentAt: new Date() },
        $inc: { reengagementReminderCount: 1 }
      }
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
    // Transient Meta-side outage (#2 Service temporarily unavailable) and rate
    // limits: retry after 4^(numberRetry) seconds
    case 2:
    case 4:
    case 80007:
    case 130429:
    case 131048:
    case 131056:
      if (retryParameters != null) {
        if (retryParameters.retryNumber >= MAX_MESSAGE_RETRY) {
          await umamiLogger({
            event: "/message-fail-too-many-requests-aborted",
            messageApp: "WhatsApp"
          });
          await logError(
            "WhatsApp",
            `WH API error ${String(error.errorCode)} aborted after ${String(MAX_MESSAGE_RETRY)} retries in ${callerFunctionLabel} to ${chatId}`,
            error.rawError ?? undefined
          );
          return false;
        }
        await umamiLogger({
          event: "/message-fail-too-many-requests",
          messageApp: "WhatsApp"
        });
        const backoffMs =
          Math.min(
            Math.pow(4, retryParameters.retryNumber) * 1000,
            MAX_BACKOFF_MS
          ) +
          Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
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
