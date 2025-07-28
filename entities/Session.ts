import { ISession, IUser, MessageApp } from "../types.ts";
import { USER_SCHEMA_VERSION } from "../models/User.ts";
import User from "../models/User.ts";
import { IRawUser } from "../models/LegacyUser.ts";
import { sendWhatsAppMessage } from "../WhatsAppApp.ts";

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

    await User.deleteOne({ chatId: rawUser.chatId });

    const user: IUser = new User({
      chatId: rawUser.chatId,
      messageApp: telegramMessageApp,
      language_code: rawUser.language_code ?? "fr",
      status: rawUser.status ?? "active",
      followedPeople: rawUser.followedPeople ?? [],
      followedFunctions: rawUser.followedFunctions ?? [],
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

export async function sendMessage(user: IUser, message: string) {
  switch (user.messageApp) {
    case "Telegram":
      await sendTelegramMessage(user.chatId, message);
      break;

    case "WhatsApp":
      await sendWhatsAppMessage(user.chatId, message);
      break;

    default:
      throw new Error(`MessageApp ${user.messageApp} not supported`);
  }
}
