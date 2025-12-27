import { ISession, IUser, MessageApp } from "../types.ts";
import { USER_SCHEMA_VERSION } from "../models/User.ts";
import User from "../models/User.ts";
import { IRawUser, LegacyRawUser_V2 } from "../models/LegacyUser.ts";
import { sendTelegramMessage } from "./TelegramSession.ts";
import { sendWhatsAppMessage } from "./WhatsAppSession.ts";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { sendSignalAppMessage } from "./SignalSession.ts";
import { SignalCli } from "signal-sdk";
import { MatrixClient } from "matrix-bot-sdk";
import { Keyboard } from "./Keyboard.ts";
import { sendMatrixMessage } from "./MatrixSession.ts";
import umami from "../utils/umami.ts";
import { logError } from "../utils/debugLogger.ts";

export const messageReceivedTimeHistory = new Map<string, Date>(); // key is ${messageApp}:${chatId}

export interface ExternalMessageOptions {
  matrixClient?: MatrixClient;
  tchapClient?: MatrixClient;
  signalCli?: SignalCli;
  telegramBotToken?: string;
  whatsAppAPI?: WhatsAppAPI;
  forceNoKeyboard?: boolean;
  keyboard?: Keyboard;
}

export async function loadUser(session: ISession): Promise<IUser | null> {
  try {
    if (session.user != null) return session.user;

    let user: IUser | null = null;

    const matchingUsers: IUser[] = await User.find({
      messageApp: session.messageApp,
      chatId: session.chatId
    });

    if (matchingUsers.length > 1) {
      await logError(
        session.messageApp,
        `Multiple users found for chatId ${session.chatId} and app ${session.messageApp}: ${matchingUsers.map((u) => u._id.toString()).join(", ")}`
      );
      await session.sendMessage(
        "Une erreur est survenue, veuillez réessayer ultérieurement."
      );
      throw new Error(
        `Multiple users found for ${matchingUsers[0].messageApp} and chatId: ` +
          matchingUsers.map((u) => u._id.toString()).join(",")
      );
    }
    if (matchingUsers.length === 1) user = matchingUsers[0];

    if (user != null) {
      if (user.followsNothing()) {
        await User.deleteOne({ _id: user._id });
        umami.log({ event: "/user-deletion-no-follow" });
        return null;
      }
      if (
        user.transferData &&
        user.transferData.expiresAt.getTime() < new Date().getTime()
      ) {
        user.transferData = undefined;
        await user.save();
      }
      if (session.roomId != null && user.roomId !== session.roomId) {
        user.roomId = session.roomId;
        await User.updateOne(
          { _id: user._id },
          { $set: { roomId: session.roomId } }
        );
      }
    }
    return user;
  } catch (error) {
    await logError(session.messageApp, "Error loadUser", error);
  }
  return null;
}

export async function migrateUser(rawUser: IRawUser): Promise<void> {
  if (rawUser.schemaVersion === USER_SCHEMA_VERSION) return;

  if (rawUser.schemaVersion < 3) {
    const legacyUser = rawUser as LegacyRawUser_V2;

    try {
      await User.collection.updateOne(
        { messageApp: legacyUser.messageApp, chatId: legacyUser.chatId },
        { $set: { schemaVersion: 3, chatId: legacyUser.chatId.toString() } }
      );
    } catch (err) {
      console.error("Migration failed:", err);
    }
  } else {
    throw new Error("Unknown schema version");
  }
  return;
}

export async function recordSuccessfulDelivery(
  messageApp: MessageApp,
  chatId: IUser["chatId"]
): Promise<void> {
  const now = new Date(); // save current time before db operations

  const user: IUser | null = await User.findOne(
    { messageApp, chatId },
    { lastMessageReceivedAt: 1 }
  ).lean();
  if (user == null) return;

  messageReceivedTimeHistory.set(
    `${messageApp}:${chatId}`,
    user.lastMessageReceivedAt
  );
  // Update lastMessageReceivedAt
  const resUserExist = await User.updateOne(
    { messageApp, chatId },
    { $set: { lastMessageReceivedAt: now } }
  );
  if (resUserExist.modifiedCount == 0) return; // no user in db

  // Check if user was blocked and mark as active
  const resUserBlocked = await User.updateOne(
    { messageApp, chatId },
    { $set: { status: "active" } }
  );
  if (resUserBlocked.modifiedCount > 0) {
    await umami.logAsync({
      event: "/user-unblocked-joel",
      messageApp
    });
  }
}

export interface MessageSendingOptionsInternal {
  keyboard?: Keyboard;
  forceNoKeyboard?: boolean;
  separateMenuMessage?: boolean;
  useAsyncUmamiLog?: boolean;
  hasAccount?: boolean;
}

export interface MessageSendingOptionsExternal {
  telegramBotToken?: string;
  matrixClient?: MatrixClient;
  tchapClient?: MatrixClient;
  signalCli?: SignalCli;
  whatsAppAPI?: WhatsAppAPI;
  forceNoKeyboard?: boolean;
  keyboard?: Keyboard;
  separateMenuMessage?: boolean;
  useAsyncUmamiLog: boolean;
  hasAccount: boolean;
}

export interface MiniUserInfo {
  messageApp: IUser["messageApp"];
  chatId: IUser["chatId"];
  roomId?: IUser["roomId"];
  status: IUser["status"];
  hasAccount: boolean;
}

export interface ExtendedMiniUserInfo extends MiniUserInfo {
  waitingReengagement: IUser["waitingReengagement"];
  lastEngagementAt: IUser["lastEngagementAt"];
}

export async function sendMessage(
  userInfo: {
    messageApp: MessageApp;
    chatId: IUser["chatId"];
    roomId?: IUser["roomId"];
    lastEngagementAt?: IUser["lastEngagementAt"];
  },
  message: string,
  options?: MessageSendingOptionsExternal
): Promise<boolean> {
  switch (userInfo.messageApp) {
    case "Matrix":
      if (options?.matrixClient == null)
        throw new Error("matrixClient is required");
      return await sendMatrixMessage(
        { matrix: options.matrixClient, messageApp: "Matrix" },
        userInfo,
        message,
        options
      );

    case "Tchap":
      if (options?.tchapClient == null)
        throw new Error("tchapClient is required");
      return await sendMatrixMessage(
        { matrix: options.tchapClient, messageApp: "Tchap" },
        userInfo,
        message,
        options
      );

    case "Signal":
      if (options?.signalCli == null) throw new Error("signalCli is required");
      return await sendSignalAppMessage(
        options.signalCli,
        userInfo.chatId,
        message,
        options
      );

    case "Telegram":
      if (options?.telegramBotToken == null)
        throw new Error("telegramBotToken is required");
      return await sendTelegramMessage(
        options.telegramBotToken,
        userInfo.chatId,
        message,
        options
      );

    case "WhatsApp":
      if (options?.whatsAppAPI == null)
        throw new Error("WhatsAppAPI is required");
      if (userInfo.lastEngagementAt == null) {
        throw new Error("lastEngagementAt is required for WhatsApp messages");
      }
      return await sendWhatsAppMessage(
        options.whatsAppAPI,
        {
          ...userInfo,
          lastEngagementAt: userInfo.lastEngagementAt,
          hasAccount: options.hasAccount,
          waitingReengagement: false,
          status: "active"
        },
        message,
        options
      );
  }
  throw new Error("Unknown messageApp : ", userInfo.messageApp);
}
