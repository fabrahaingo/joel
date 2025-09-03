import { Keyboard, ISession, IUser, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import { loadUser } from "./Session.ts";
import umami from "../utils/umami.ts";
import {
  markdown2html,
  markdown2plainText,
  splitText
} from "../utils/text.utils.ts";
import { MatrixClient, MatrixError } from "matrix-bot-sdk";

const MATRIX_MESSAGE_CHAR_LIMIT = 5000;
const MATRIX_COOL_DOWN_DELAY_SECONDS = 0.5;

export const MATRIX_API_SENDING_CONCURRENCY = 1;

const mainMenuKeyboardMatrix: Keyboard = [
  [{ text: "🔎 Rechercher" }, { text: "🧐 Lister mes suivis" }],
  [
    { text: "🏛️️ Ajouter une organisation" },
    { text: "👨‍💼 Ajouter une fonction" }
  ],
  [{ text: "❓ Aide & Contact" }]
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

  async sendMessage(formattedData: string, keyboard?: Keyboard): Promise<void> {
    const mArr = splitText(formattedData, MATRIX_MESSAGE_CHAR_LIMIT);
    for (let i = 0; i < mArr.length; i++) {
      const promptId = await this.matrixClient.sendMessage(this.roomId, {
        msgtype: "m.text",
        body: markdown2plainText(mArr[i]),
        format: "org.matrix.custom.html",
        formatted_body: markdown2html(mArr[i])
      });
      if (i == mArr.length - 1 && keyboard != null) {
        for (const key of keyboard.flat().map((b) => b.text)) {
          await this.matrixClient.sendEvent(this.roomId, "m.reaction", {
            "m.relates_to": {
              rel_type: "m.annotation",
              event_id: promptId,
              key // emoji or arbitrary string
            }
          });
        }
      }
      await umami.log({ event: "/message-sent-matrix" });
      // prevent hitting the WH API rate limit
      await new Promise(
        (
          resolve // We wait 1 second between messages to avoid dense bursts
        ) => setTimeout(resolve, MATRIX_COOL_DOWN_DELAY_SECONDS * 1000)
      );
    }
  }
}

export async function sendMatrixMessage(
  matrixClient: MatrixClient,
  chatId: string,
  message: string,
  roomId?: string,
  retryNumber = 0
): Promise<boolean> {
  if (retryNumber > 5) {
    await umami.log({ event: "/matrix-too-many-requests-aborted" });
    return false;
  } // give up after 5 retries
  const mArr = splitText(message, MATRIX_MESSAGE_CHAR_LIMIT);
  let i = 0;
  try {
    roomId ??= await findUserDMRoomId(matrixClient, chatId);
    if (!roomId) {
      console.log("Could not find DM room for user " + chatId);
      return false;
    }
    for (; i < mArr.length; i++) {
      await matrixClient.sendMessage(roomId, {
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
  } catch (error) {
    const mError = error as MatrixError;
    switch (mError.errcode) {
      case "M_LIMIT_EXCEEDED": {
        await umami.log({ event: "/matrix-too-many-requests" });
        const retryAfterms = mError.retryAfterMs ?? 1000;
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.pow((2 * retryAfterms) / 1000, retryNumber) * 1000
          )
        );
        return sendMatrixMessage(
          matrixClient,
          chatId,
          mArr.slice(i).join("\n"),
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

async function findUserDMRoomId(
  client: MatrixClient,
  userId: string
): Promise<string | undefined> {
  const data = (await client
    .getAccountData("m.direct")
    .catch(() => ({}))) as any;
  const rooms = Array.isArray(data?.[userId]) ? (data[userId] as string[]) : [];
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
        `Cette fonctionnalité n'est pas encore disponible sur ${session.messageApp}`,
        session.mainMenuKeyboard
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
