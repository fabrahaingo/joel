import { ISession, IUser, MessageApp } from "../types.ts";
import { USER_SCHEMA_VERSION } from "../models/User.ts";
import User from "../models/User.ts";
import { IRawUser, LegacyRawUser_V1 } from "../models/LegacyUser.ts";
import { sendTelegramMessage } from "./TelegramSession.ts";
import { sendWhatsAppMessage } from "./WhatsAppSession.ts";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";

export async function loadUser(session: ISession): Promise<IUser | null> {
  if (session.user != null) return null;

  let user: IUser | null;

  user = await User.findOne({
    messageApp: session.messageApp,
    chatId: session.chatId
  });

  // Legacy for Telegram users stored with a number chatId and without messageApp
  user ??= await User.findOne({
    chatId: session.chatId
  });

  // migrate the user schema if necessary
  if (user != null) user = await migrateUser(user);

  return user;
}

export async function migrateUser(rawUser: IRawUser): Promise<IUser> {
  if (rawUser.schemaVersion === USER_SCHEMA_VERSION) return rawUser as IUser;

  if (rawUser.schemaVersion == null || rawUser.schemaVersion === 1) {
    const telegramMessageApp: MessageApp = "Telegram"; // To ensure typing

    const legacyUser = rawUser as LegacyRawUser_V1;

    await User.deleteOne({ chatId: rawUser.chatId });

    let newFollowedFunctions: IUser["followedFunctions"] = [];
    if (legacyUser.followedFunctions !== undefined)
      newFollowedFunctions = legacyUser.followedFunctions.map((tag) => ({
        functionTag: tag,
        lastUpdate: new Date()
      }));

    const user: IUser = new User({
      chatId: legacyUser.chatId,
      messageApp: telegramMessageApp,
      language_code: legacyUser.language_code ?? "fr",
      status: legacyUser.status ?? "active",
      followedPeople: legacyUser.followedPeople ?? [],
      followedFunctions: newFollowedFunctions,
      followedOrganisations: [],
      followedNames: [],
      schemaVersion: 2
    });

    try {
      await user.save();
    } catch (err) {
      console.error("Migration failed:", err);
    }
    return user;
  } else {
    throw new Error("Unknown schema version");
  }
}

export async function sendMessage(
  user: IUser,
  message: string,
  whatsAppAPI?: WhatsAppAPI
) {
  switch (user.messageApp) {
    case "Telegram":
      await sendTelegramMessage(user.chatId, message);
      return;

    case "WhatsApp":
      if (whatsAppAPI == null) throw new Error("WhatsAppAPI is required");
      await sendWhatsAppMessage(whatsAppAPI, user.chatId, message);
      return;
  }
}
