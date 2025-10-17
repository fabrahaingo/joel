import { ISession, IUser, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import {
  loadUser,
  MessageSendingOptionsInternal,
  recordSuccessfulDelivery
} from "./Session.ts";
import umami, { UmamiEvent } from "../utils/umami.ts";
import {
  markdown2html,
  markdown2plainText,
  splitText
} from "../utils/text.utils.ts";
import { MatrixClient, MatrixError } from "matrix-bot-sdk";
import { Keyboard, KEYBOARD_KEYS, KeyboardKey } from "./Keyboard.ts";
import Umami from "../utils/umami.ts";

const MATRIX_MESSAGE_CHAR_LIMIT = 5000;
const MATRIX_COOL_DOWN_DELAY_SECONDS = 1;

export const MATRIX_API_SENDING_CONCURRENCY = 1;

const mainMenuKeyboardMatrix: Keyboard = [[KEYBOARD_KEYS.MAIN_MENU.key]];

const fullMenuKeyboard: KeyboardKey[] = [
  KEYBOARD_KEYS.PEOPLE_SEARCH.key,
  KEYBOARD_KEYS.ORGANISATION_FOLLOW.key,
  KEYBOARD_KEYS.FUNCTION_FOLLOW.key,
  KEYBOARD_KEYS.ENA_INSP_PROMO_SEARCH_LONG_NO_KEYBOARD.key,
  KEYBOARD_KEYS.REFERENCE_FOLLOW_NO_KEYBOARD.key,
  KEYBOARD_KEYS.FOLLOWS_LIST.key,
  KEYBOARD_KEYS.STATS.key,
  KEYBOARD_KEYS.HELP.key
];

const MatrixMessageApp: MessageApp = "Matrix";

export class MatrixSession implements ISession {
  messageApp = MatrixMessageApp;
  matrixClient: MatrixClient;
  language_code: string;
  chatId: string;
  roomId: string;
  user: IUser | null | undefined = undefined;
  isReply: boolean | undefined;
  mainMenuKeyboard: Keyboard;

  constructor(
    matrixClient: MatrixClient,
    chatId: string,
    roomId: string,
    language_code: string
  ) {
    this.matrixClient = matrixClient;
    this.chatId = chatId;
    this.roomId = roomId;
    this.language_code = language_code;
    this.mainMenuKeyboard = mainMenuKeyboardMatrix;
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
    //await this.telegramBot.sendChatAction(this.chatIdTg, "typing");
  }

  async log(args: { event: UmamiEvent }) {
    await Umami.log(args.event, this.messageApp);
  }

  async sendMessage(
    formattedData: string,
    options?: MessageSendingOptionsInternal
  ): Promise<void> {
    await sendMatrixMessage(
      this.matrixClient,
      this.chatId,
      formattedData,
      options,
      this.roomId
    );
  }
}

export async function sendMatrixMessage(
  matrixClient: MatrixClient,
  chatId: string,
  message: string,
  options?: MessageSendingOptionsInternal,
  roomId?: string,
  retryNumber = 0
): Promise<boolean> {
  if (retryNumber > 5) {
    await umami.log("/message-fail-too-many-requests-aborted", "Matrix");
    return false;
  } // give up after 5 retries
  let keyboard = options?.keyboard;
  if (!options?.forceNoKeyboard) keyboard ??= mainMenuKeyboardMatrix;

  const mArr = splitText(message, MATRIX_MESSAGE_CHAR_LIMIT);
  let i = 0;
  try {
    roomId ??= await findUserDMRoomId(matrixClient, chatId);
    if (!roomId) {
      console.log("Could not find DM room for user " + chatId);
      return false;
    }
    let promptId = "";
    for (; i < mArr.length; i++) {
      promptId = await matrixClient.sendMessage(roomId, {
        msgtype: "m.text",
        body: markdown2plainText(mArr[i]),
        format: "org.matrix.custom.html",
        formatted_body: markdown2html(mArr[i])
      });

      await umami.log("/message-sent", "Matrix");

      // prevent hitting the Signal API rate limit
      await new Promise((resolve) =>
        setTimeout(resolve, MATRIX_COOL_DOWN_DELAY_SECONDS * 1000)
      );
    }
    if (options?.separateMenuMessage)
      await sendPollMenu(matrixClient, roomId, {
        title: KEYBOARD_KEYS.MAIN_MENU.key.text,
        options: fullMenuKeyboard.map((k) => ({ text: k.text }))
      });
    else if (keyboard != null)
      await sendMatrixReactions(
        matrixClient,
        chatId,
        keyboard.flat().map((k) => k.text),
        promptId,
        roomId
      );
  } catch (error) {
    const mError = error as MatrixError;
    switch (mError.errcode) {
      case "M_LIMIT_EXCEEDED": {
        await umami.log("/message-fail-too-many-requests", "Matrix");
        const retryAfterMs =
          mError.retryAfterMs ?? MATRIX_COOL_DOWN_DELAY_SECONDS * 1000;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, retryNumber) * retryAfterMs)
        );
        return sendMatrixMessage(
          matrixClient,
          chatId,
          mArr.slice(i).join("\n"),
          options,
          roomId,
          retryNumber + 1
        );
      }
      case "M_FORBIDDEN":
        await umami.log("/user-blocked-joel", "Matrix");
        await User.updateOne(
          { messageApp: "Matrix", chatId: chatId },
          { $set: { status: "blocked" } }
        );
        break;
      default:
        console.log(error);
    }
    return false;
  }
  await recordSuccessfulDelivery("Matrix", chatId);

  return true;
}

interface PollMenu {
  title: string;
  options: { text: string }[];
}

export async function sendPollMenu(
  matrixClient: MatrixClient,
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

  await matrixClient.sendEvent(
    roomId,
    "org.matrix.msc3381.poll.start",
    content
  );
  await umami.log("/message-sent", "Matrix");

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
  matrixClient: MatrixClient,
  chatId: string,
  reactions: string[],
  eventId: string,
  roomId?: string,
  retryNumber = 0
): Promise<boolean> {
  if (retryNumber > 5) {
    await umami.log("/message-fail-too-many-requests-aborted", "Matrix");
    return false;
  }

  let i = 0;
  try {
    roomId ??= await findUserDMRoomId(matrixClient, chatId);
    if (!roomId) {
      console.log("Could not find DM room for user " + chatId);
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
      await matrixClient.sendEvent(roomId, "m.reaction", content);
    }
  } catch (error) {
    const mError = error as MatrixError;
    switch (mError.errcode) {
      case "M_LIMIT_EXCEEDED": {
        await umami.log("/message-fail-too-many-requests", "Matrix");
        const retryAfterMs =
          mError.retryAfterMs ?? MATRIX_COOL_DOWN_DELAY_SECONDS * 1000;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, retryNumber) * retryAfterMs)
        );
        return await sendMatrixReactions(
          matrixClient,
          chatId,
          reactions.slice(i),
          eventId,
          roomId,
          retryNumber + 1
        );
      }
      default:
        console.log(error);
    }
    return false;
  }
  return true;
}

type DirectRoomData = Record<string, string[]>;

async function findUserDMRoomId(
  client: MatrixClient,
  userId: string
): Promise<string | undefined> {
  const data = (await client
    .getAccountData("m.direct")
    .catch(() => ({}) as DirectRoomData)) as DirectRoomData;
  const rooms = Array.isArray(data[userId]) ? data[userId] : [];
  return rooms.length ? rooms[0] : undefined; // or validate with is1to1()
}

export async function extractMatrixSession(
  session: ISession,
  userFacingError?: boolean
): Promise<MatrixSession | undefined> {
  if (session.messageApp !== "Matrix") {
    console.log("Session is not a MatrixSession");
    if (userFacingError) {
      await session.sendMessage(
        `Cette fonctionnalité n'est pas encore disponible sur ${session.messageApp}`
      );
    }
    return undefined;
  }
  if (!(session instanceof MatrixSession)) {
    console.log(
      "Session messageApp is Matrix, but session is not a MatrixSession"
    );
    return undefined;
  }

  return session;
}
