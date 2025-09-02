import { Keyboard, ISession, IUser, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import { loadUser } from "./Session.ts";
import umami from "../utils/umami.ts";
import { splitText } from "../utils/text.utils.ts";
import { MatrixClient } from "matrix-bot-sdk";

const MATRIX_MESSAGE_CHAR_LIMIT = 3000;
const MATRIX_COOL_DOWN_DELAY_SECONDS = 1; // 1 message per second for the same user

export const MATRIX_API_SENDING_CONCURRENCY = 30; // 30 messages per second global

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
    for (const elem of mArr) {
      await this.matrixClient.sendMessage(this.roomId, {
        msgtype: "m.text",
        body: elem
        //format: "org.matrix.custom.html",
        //formatted_body: 'See the <a href="https://example.com">docs</a> and <b>bold</b>.',
      });
      await umami.log({ event: "/message-sent-matrix" });
    }
  }
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
