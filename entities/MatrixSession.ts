import { ISession, IUser, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import {
  loadUser,
  MessageSendingOptionsInternal,
  MiniUserInfo,
  recordSuccessfulDelivery
} from "./Session.ts";
import umami, { UmamiEvent, UmamiLogger } from "../utils/umami.ts";
import {
  markdown2html,
  markdown2plainText,
  splitText
} from "../utils/text.utils.ts";
import { MatrixClient, MatrixError } from "matrix-bot-sdk";
import { Keyboard, KEYBOARD_KEYS, KeyboardKey } from "./Keyboard.ts";
import { logError } from "../utils/debugLogger.ts";

export const MATRIX_MESSAGE_CHAR_LIMIT = 5000;
const MATRIX_COOL_DOWN_DELAY_MS = 1000;
const DIRECT_ROOM_CACHE_TTL_MS = 5 * 60 * 1000;
const JOINED_ROOMS_CACHE_TTL_MS = 60 * 1000;

export const MATRIX_API_SENDING_CONCURRENCY = 1;

const MAX_MESSAGE_RETRY = 5;

const mainMenuKeyboardMatrix: Keyboard = [[KEYBOARD_KEYS.MAIN_MENU.key]];

const fullMenuKeyboard: KeyboardKey[] = [
  KEYBOARD_KEYS.TEXT_SEARCH.key,
  KEYBOARD_KEYS.PEOPLE_SEARCH.key,
  KEYBOARD_KEYS.ORGANISATION_FOLLOW.key,
  KEYBOARD_KEYS.FUNCTION_FOLLOW.key,
  KEYBOARD_KEYS.ENA_INSP_PROMO_SEARCH_LONG_NO_KEYBOARD.key,
  KEYBOARD_KEYS.FOLLOWS_LIST.key,
  KEYBOARD_KEYS.HELP.key
];

interface ExtendedMatrixClient {
  matrix: MatrixClient;
  messageApp: MessageApp;
}

const directRoomCache = new Map<
  string,
  { roomId: string; expiresAt: number }
>();
let joinedRoomsCache: { rooms: Set<string>; expiresAt: number } | undefined =
  undefined;

export class MatrixSession implements ISession {
  messageApp: MessageApp;
  client: ExtendedMatrixClient;
  language_code: string;
  chatId: string;
  roomId: string;
  user: IUser | null | undefined = undefined;
  isReply: boolean | undefined;
  mainMenuKeyboard: Keyboard;

  constructor(
    messageApp: "Matrix" | "Tchap",
    client: MatrixClient,
    chatId: string,
    roomId: string,
    language_code: string
  ) {
    if (!["Matrix", "Tchap"].some((m) => m === messageApp))
      throw new Error(
        "Only Matrix and Tchap modes are allowed for matrix apps"
      );

    this.messageApp = messageApp;
    this.client = { matrix: client, messageApp };
    this.chatId = chatId;
    this.roomId = roomId;
    this.language_code = language_code;
    this.mainMenuKeyboard = mainMenuKeyboardMatrix;
  }

  // try to fetch user from db
  async loadUser(): Promise<void> {
    this.user = await loadUser(this);
    // If the roomId has changed, update the user's roomId'
    if (this.user && this.user.roomId !== this.roomId) {
      this.user.roomId = this.roomId;
      await this.user.save();
    }
  }

  // Force create a user record
  async createUser() {
    this.user = await User.findOrCreate(this);
  }

  sendTypingAction() {
    //await this.telegramBot.sendChatAction(this.chatIdTg, "typing");
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
    return await sendMatrixMessage(
      this.client,
      { messageApp: this.messageApp, chatId: this.chatId, roomId: this.roomId },
      formattedData,
      options
    );
  }
}

export async function sendMatrixMessage(
  client: ExtendedMatrixClient,
  userInfo: MiniUserInfo,
  message: string,
  options?: MessageSendingOptionsInternal,
  retryNumber = 0
): Promise<boolean> {
  const umamiLogger: UmamiLogger =
    options?.useAsyncUmamiLog === true ? umami.logAsync : umami.log;
  let keyboard = options?.keyboard;
  if (!options?.forceNoKeyboard) keyboard ??= mainMenuKeyboardMatrix;

  const mArr = splitText(message, MATRIX_MESSAGE_CHAR_LIMIT);
  let i = 0;
  try {
    let joinedRoomIds: Set<string> | undefined;

    if (!userInfo.roomId) {
      joinedRoomIds = await getJoinedRooms(client.matrix);
    } else if (
      joinedRoomsCache?.expiresAt &&
      joinedRoomsCache.expiresAt > Date.now()
    ) {
      joinedRoomIds = joinedRoomsCache.rooms;
    }

    if (
      userInfo.roomId &&
      joinedRoomIds &&
      !joinedRoomIds.has(userInfo.roomId)
    ) {
      joinedRoomIds = await getJoinedRooms(client.matrix, true);

      try {
        await User.updateOne(
          { messageApp: client.messageApp, chatId: userInfo.chatId },
          { $unset: { roomId: 1 } }
        );
      } catch (updateError) {
        await logError(
          userInfo.messageApp,
          `${userInfo.messageApp}: failed to unset stored room for ${userInfo.chatId}`,
          updateError
        );
      }

      directRoomCache.delete(userInfo.chatId);
      userInfo.roomId = undefined;
    }

    if (!userInfo.roomId) {
      const dmRoomId = await findUserDMRoomId(
        client.matrix,
        userInfo.chatId,
        joinedRoomIds
      );

      if (dmRoomId) {
        try {
          await User.updateOne(
            { messageApp: client.messageApp, chatId: userInfo.chatId },
            { $set: { roomId: dmRoomId } }
          );
        } catch (updateError) {
          await logError(
            userInfo.messageApp,
            `${userInfo.messageApp}: failed to persist DM room for ${userInfo.chatId}`,
            updateError
          );
        }
        userInfo.roomId = dmRoomId;
        directRoomCache.set(userInfo.chatId, {
          roomId: dmRoomId,
          expiresAt: Date.now() + DIRECT_ROOM_CACHE_TTL_MS
        });
      }
    }

    if (!userInfo.roomId) {
      await logError(
        userInfo.messageApp,
        `${userInfo.messageApp}: Could not find DM room for user ${userInfo.chatId}`
      );
      return false;
    }
    let promptId = "";
    for (; i < mArr.length; i++) {
      promptId = await client.matrix.sendMessage(userInfo.roomId, {
        msgtype: "m.text",
        body: markdown2plainText(mArr[i]),
        format: "org.matrix.custom.html",
        formatted_body: markdown2html(mArr[i])
      });

      await umamiLogger({
        event: "/message-sent",
        messageApp: client.messageApp
      });

      // short pause to avoid spamming the homeserver
      await new Promise((resolve) =>
        setTimeout(resolve, MATRIX_COOL_DOWN_DELAY_MS)
      );
    }
    if (options?.separateMenuMessage)
      await sendPollMenu(client, userInfo.roomId, {
        title: KEYBOARD_KEYS.MAIN_MENU.key.text,
        options: fullMenuKeyboard.map((k) => ({ text: k.text }))
      });
    else if (keyboard != null) {
      const res = await sendMatrixReactions(
        client,
        userInfo,
        keyboard.flat().map((k) => k.text),
        promptId
      );
      if (!res) return false;
    }
  } catch (error) {
    const mError = error as MatrixError | NodeJS.ErrnoException;
    let errCode: string | undefined = undefined;
    if ("errcode" in mError) {
      errCode = mError.errcode;
    } else if ("code" in mError) {
      errCode = mError.code;
    }

    switch (errCode) {
      case "M_LIMIT_EXCEEDED": {
        if (retryNumber > MAX_MESSAGE_RETRY) {
          await umamiLogger({
            event: "/message-fail-too-many-requests-aborted"
          });
          return false;
        }
        await umamiLogger({
          event: "/message-fail-too-many-requests",
          messageApp: client.messageApp
        });
        let retryAfterMs = MATRIX_COOL_DOWN_DELAY_MS;
        if ("retryAfterMs" in mError && mError.retryAfterMs)
          retryAfterMs = mError.retryAfterMs;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, retryNumber) * retryAfterMs)
        );
        return sendMatrixMessage(
          client,
          userInfo,
          mArr.slice(i).join("\n"),
          options,
          retryNumber + 1
        );
      }
      case "ECONNRESET":
      case "EPIPE":
      case "ETIMEDOUT":
      case "ECONNABORTED":
        if (retryNumber > MAX_MESSAGE_RETRY) {
          await logError(
            client.messageApp,
            `Error sending ${client.messageApp} message after ${String(MAX_MESSAGE_RETRY)} retries`,
            error
          );
          return false;
        }
        return sendMatrixMessage(
          client,
          userInfo,
          mArr.slice(i).join("\n"),
          options,
          retryNumber + 1
        );
      case "M_FORBIDDEN": // user blocked the bot, user left the room ...
        umami.log({
          event: "/user-blocked-joel",
          messageApp: client.messageApp
        });
        directRoomCache.delete(userInfo.chatId);
        await User.updateOne(
          { messageApp: client.messageApp, chatId: userInfo.chatId },
          { $set: { status: "blocked" } }
        );
        break;
      default:
        await logError(
          client.messageApp,
          `Error sending ${client.messageApp} message`,
          error
        );
    }
    return false;
  }
  await recordSuccessfulDelivery(client.messageApp, userInfo.chatId);

  return true;
}

interface PollMenu {
  title: string;
  options: { text: string }[];
}

export async function sendPollMenu(
  client: ExtendedMatrixClient,
  roomId: string,
  pollMenu: PollMenu
): Promise<boolean> {
  //const body = fallbackBody(pollMenu.title, pollMenu.options);

  const content = {
    //"org.matrix.msc1767.text": body,
    "org.matrix.msc3381.poll.start": {
      answers: pollMenu.options.map((o) => ({
        id: o.text,
        "org.matrix.msc1767.text": o.text
      })),
      kind: "org.matrix.msc3381.poll.undisclosed",
      max_selections: 1,
      question: {
        "org.matrix.msc1767.text": pollMenu.title
      }
    }
  };

  await client.matrix.sendEvent(
    roomId,
    "org.matrix.msc3381.poll.start",
    content
  );
  umami.log({ event: "/message-sent", messageApp: client.messageApp });

  return true;
}

export async function closePollMenu(
  matrixClient: MatrixClient,
  roomId: string,
  event_id: string
): Promise<boolean> {
  const content = {
    "org.matrix.msc3381.poll.end": {},
    "m.relates_to": {
      event_id: event_id,
      rel_type: "m.reference"
    },
    "org.matrix.msc1767.text": "Menu non disponible"
  };
  await matrixClient.sendEvent(roomId, "org.matrix.msc3381.poll.end", content);

  return true;
}

async function sendMatrixReactions(
  client: ExtendedMatrixClient,
  userInfo: MiniUserInfo,
  reactions: string[],
  eventId: string,
  retryNumber = 0
): Promise<boolean> {
  let i = 0;
  try {
    const joinedRooms = await getJoinedRooms(client.matrix);
    userInfo.roomId ??= await findUserDMRoomId(
      client.matrix,
      userInfo.chatId,
      joinedRooms
    );
    if (!userInfo.roomId) {
      await logError(
        userInfo.messageApp,
        "Could not find DM room for user " + userInfo.chatId
      );
      return false;
    }

    for (; i < reactions.length; i++) {
      const content = {
        "m.relates_to": {
          rel_type: "m.annotation",
          event_id: eventId,
          key: reactions[i]
        }
      };
      await client.matrix.sendEvent(userInfo.roomId, "m.reaction", content);
    }
  } catch (error) {
    const mError = error as MatrixError | NodeJS.ErrnoException;
    let errCode: string | undefined = undefined;
    if ("errcode" in mError) {
      errCode = mError.errcode;
    } else if ("code" in mError) {
      errCode = mError.code;
    }

    switch (errCode) {
      case "M_LIMIT_EXCEEDED": {
        if (retryNumber > MAX_MESSAGE_RETRY) {
          umami.log({ event: "/message-fail-too-many-requests-aborted" });
          return false;
        }
        umami.log({
          event: "/message-fail-too-many-requests",
          messageApp: client.messageApp
        });
        let retryAfterMs = MATRIX_COOL_DOWN_DELAY_MS;
        if ("retryAfterMs" in mError && mError.retryAfterMs)
          retryAfterMs = mError.retryAfterMs;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, retryNumber) * retryAfterMs)
        );
        return await sendMatrixReactions(
          client,
          userInfo,
          reactions.slice(i),
          eventId,
          retryNumber + 1
        );
      }
      case "ECONNRESET":
      case "EPIPE":
      case "ETIMEDOUT":
      case "ECONNABORTED":
        if (retryNumber > MAX_MESSAGE_RETRY) {
          await logError(
            client.messageApp,
            `Error sending ${client.messageApp} message after ${String(MAX_MESSAGE_RETRY)} retries`,
            error
          );
          return false;
        }
        return await sendMatrixReactions(
          client,
          userInfo,
          reactions.slice(i),
          eventId,
          retryNumber + 1
        );
      default:
        console.log(error);
        umami.log({
          event: "/console-log",
          messageApp: userInfo.messageApp
        });
    }
    return false;
  }
  return true;
}

type DirectRoomData = Record<string, string[]>;

async function getJoinedRooms(
  client: MatrixClient,
  forceRefresh = false
): Promise<Set<string>> {
  const now = Date.now();
  if (
    !forceRefresh &&
    joinedRoomsCache?.expiresAt &&
    joinedRoomsCache.expiresAt > now
  )
    return joinedRoomsCache.rooms;

  const roomIds = await client.getJoinedRooms().catch(() => [] as string[]);

  joinedRoomsCache = {
    rooms: new Set(roomIds),
    expiresAt: now + JOINED_ROOMS_CACHE_TTL_MS
  };

  return joinedRoomsCache.rooms;
}

async function findUserDMRoomId(
  client: MatrixClient,
  userId: string,
  joinedRoomIds?: Set<string>
): Promise<string | undefined> {
  const cached = directRoomCache.get(userId);
  const now = Date.now();
  if (cached?.expiresAt && cached.expiresAt > now) return cached.roomId;

  const data = (await client
    .getAccountData("m.direct")
    .catch(() => ({}) as DirectRoomData)) as DirectRoomData;
  const rooms = Array.isArray(data[userId]) ? data[userId] : [];
  if (!rooms.length) {
    directRoomCache.delete(userId);
    return undefined;
  }

  let joinedRooms = joinedRoomIds;
  joinedRooms ??= await getJoinedRooms(client);

  const roomId = rooms.find((id) => joinedRooms.has(id));
  if (roomId == null) {
    directRoomCache.delete(userId);
    return undefined;
  }

  directRoomCache.set(userId, {
    roomId,
    expiresAt: now + DIRECT_ROOM_CACHE_TTL_MS
  });

  return roomId;
}
export async function extractMatrixSession(
  session: ISession,
  userFacingError?: boolean
): Promise<MatrixSession | undefined> {
  if (["Matrix", "Tchap"].some((m) => m !== session.messageApp)) {
    await logError(session.messageApp, "Session is not a MatrixSession");
    if (userFacingError) {
      await session.sendMessage(
        `Cette fonctionnalité n'est pas encore disponible sur ${session.messageApp}`
      );
    }
    return undefined;
  }
  if (!(session instanceof MatrixSession)) {
    await logError(
      session.messageApp,
      "Session messageApp is Matrix, but session is not a MatrixSession"
    );
    return undefined;
  }

  return session;
}
