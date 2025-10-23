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

export interface ExternalMessageOptions {
  matrixClient?: MatrixClient;
  signalCli?: SignalCli;
  telegramBotToken?: string;
  whatsAppAPI?: WhatsAppAPI;
  forceNoKeyboard?: boolean;
  keyboard?: Keyboard;
}

export async function loadUser(session: ISession): Promise<IUser | null> {
  if (session.user != null) return null;

  const user: IUser | null = await User.findOne({
    messageApp: session.messageApp,
    chatId: session.chatId
  });

  if (user == null) {
    const legacyUser = (await User.collection.findOne({
      messageApp: session.messageApp,
      chatId: session.chatId
    })) as IRawUser | null;
    if (legacyUser !== null) {
      await migrateUser(legacyUser);
      // now return the migrated user
      return User.findOne({
        messageApp: session.messageApp,
        chatId: session.chatId
      });
    }
  }
  return user;
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
  chatId: string
): Promise<void> {
  await User.updateOne(
    { messageApp, chatId },
    { $set: { lastMessageReceivedAt: new Date(), status: "active" } }
  );
}

export interface MessageSendingOptionsInternal {
  keyboard?: Keyboard;
  forceNoKeyboard?: boolean;
  separateMenuMessage?: boolean;
}

export interface MessageSendingOptionsExternal {
  telegramBotToken?: string;
  matrixClient?: MatrixClient;
  signalCli?: SignalCli;
  whatsAppAPI?: WhatsAppAPI;
  forceNoKeyboard?: boolean;
  keyboard?: Keyboard;
  separateMenuMessage?: boolean;
}

export async function sendMessage(
  messageApp: MessageApp,
  chatId: string,
  message: string,
  options?: MessageSendingOptionsExternal
): Promise<boolean> {
  switch (messageApp) {
    case "Matrix":
      if (options?.matrixClient == null)
        throw new Error("matrixClient is required");
      return await sendMatrixMessage(
        options.matrixClient,
        chatId,
        message,
        options
      );

    case "Signal":
      if (options?.signalCli == null) throw new Error("signalCli is required");
      return await sendSignalAppMessage(options.signalCli, chatId, message);

    case "Telegram":
      if (options?.telegramBotToken == null)
        throw new Error("telegramBotToken is required");
      return await sendTelegramMessage(
        options.telegramBotToken,
        chatId,
        message,
        options.keyboard
      );

    case "WhatsApp":
      if (options?.whatsAppAPI == null)
        throw new Error("WhatsAppAPI is required");
      return await sendWhatsAppMessage(
        options.whatsAppAPI,
        chatId,
        message,
        options
      );
  }
  throw new Error("Unknown messageApp : ", messageApp);
}
