import { ISession } from "../types.ts";
import { processMessage } from "./Commands.ts";
import { getHelpText } from "./help.ts";
import { logError } from "../utils/debugLogger.ts";

export const startCommand = async (
  session: ISession,
  userMessage: string
): Promise<void> => {
  const messageSplit = userMessage.split(/!|\/start/i);

  try {
    await session.sendTypingAction();

    // if "Bonjour JOEL ! Suivre ..." or "/start Suivre ..."
    const commandMsg = messageSplit
      .slice(1)
      .map((part) => part.trim())
      .find((part) => part.length > 0);

    if (commandMsg != null) {
      const commandMsg = messageSplit[1].trim();
      if (commandMsg.toLowerCase().startsWith("suivreo"))
        session.log({ event: "/start-from-organisation" });
      else if (commandMsg.toLowerCase().startsWith("suivref"))
        session.log({ event: "/start-from-tag" });
      else if (
        commandMsg.toLowerCase().startsWith("suiv") ||
        commandMsg.toLowerCase().startsWith("recherche")
      )
        session.log({ event: "/start-from-people" });

      await session.sendMessage(getHelpText(session), {
        forceNoKeyboard: true
      });

      await processMessage(session, commandMsg);
    } else {
      //  start classique
      await session.sendMessage(getHelpText(session), {
        separateMenuMessage: true
      });
      session.log({ event: "/start" });
    }
  } catch (error) {
    await logError(session.messageApp, "Error in /start command", error);
  }
};
