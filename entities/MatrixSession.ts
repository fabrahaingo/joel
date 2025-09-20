import { ISession, IUser, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import { loadUser } from "./Session.ts";
import umami from "../utils/umami.ts";
import {
  markdown2html,
  markdown2plainText,
  splitText
} from "../utils/text.utils.ts";
import { MatrixClient, MatrixError } from "matrix-bot-sdk";
import { Keyboard, KEYBOARD_KEYS } from "./Keyboard.ts";

const MATRIX_MESSAGE_CHAR_LIMIT = 5000;
const MATRIX_COOL_DOWN_DELAY_SECONDS = 1;

export const MATRIX_API_SENDING_CONCURRENCY = 1;

const mainMenuKeyboardMatrix: Keyboard = [[KEYBOARD_KEYS.COMMAND_LIST.key]];

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

  log = umami.log;

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

  async sendMessage(
    formattedData: string,
    keyboard?: Keyboard,
    options?: {
      forceNoKeyboard?: boolean;
    }
  ): Promise<void> {
    await sendMatrixMessage(
      this.matrixClient,
      this.chatId,
      formattedData,
      keyboard,
      options,
      this.roomId
    );
  }
}

export async function sendMatrixMessage(
  matrixClient: MatrixClient,
  chatId: string,
  message: string,
  keyboard?: Keyboard,
  options?: {
    forceNoKeyboard?: boolean;
  },
  roomId?: string,
  retryNumber = 0
): Promise<boolean> {
  if (retryNumber > 5) {
    await umami.log({ event: "/matrix-too-many-requests-aborted" });
    return false;
  } // give up after 5 retries
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

      await umami.log({ event: "/message-sent-matrix" });

      // prevent hitting the Signal API rate limit
      await new Promise((resolve) =>
        setTimeout(resolve, MATRIX_COOL_DOWN_DELAY_SECONDS * 1000)
      );
    }
    if (keyboard != null)
      await sendMatrixReactions(
        matrixClient,
        chatId,
        keyboard.flat().map((k) => k.text),
        roomId,
        promptId
      );
  } catch (error) {
    const mError = error as MatrixError;
    switch (mError.errcode) {
      case "M_LIMIT_EXCEEDED": {
        await umami.log({ event: "/matrix-too-many-requests" });
        const retryAfterMs =
          mError.retryAfterMs ?? MATRIX_COOL_DOWN_DELAY_SECONDS * 1000;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, retryNumber) * retryAfterMs)
        );
        return sendMatrixMessage(
          matrixClient,
          chatId,
          mArr.slice(i).join("\n"),
          keyboard,
          options,
          roomId,
          retryNumber + 1
        );
      }
      case "M_FORBIDDEN":
        await umami.log({ event: "/user-blocked-joel" });
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
  return true;
}

async function sendMatrixReactions(
  matrixClient: MatrixClient,
  chatId: string,
  reactions: string[],
  event_id: string,
  roomId?: string,
  idx = 0,
  retryNumber = 0
): Promise<boolean> {
  if (retryNumber > 5) return false;

  let i = idx;
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
          event_id,
          key: reactions[i]
        }
      };
      await matrixClient.sendEvent(roomId, "m.reaction", content);
    }
  } catch (error) {
    const mError = error as MatrixError;
    switch (mError.errcode) {
      case "M_LIMIT_EXCEEDED": {
        await umami.log({ event: "/matrix-too-many-requests" });
        const retryAfterMs =
          mError.retryAfterMs ?? MATRIX_COOL_DOWN_DELAY_SECONDS * 1000;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, retryNumber) * retryAfterMs)
        );
        return await sendMatrixReactions(
          matrixClient,
          chatId,
          reactions,
          event_id,
          roomId,
          idx,
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
