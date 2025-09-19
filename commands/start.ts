import { ISession } from "../types.ts";
import { BotMessages } from "../entities/BotMessages.ts";
import { processMessage } from "./Commands.ts";

export const startCommand = async (
  session: ISession,
  userMessage: string
): Promise<void> => {
  const messageSplit = userMessage.split(/!|\/start/i);

  try {
    await session.sendTypingAction();

    const botName = process.env.BOT_NAME;
    const botChannel = process.env.BOT_CHANNEL;

    const mardownLink = session.messageApp === "Telegram";

    let message = BotMessages.START.replace(
      "{botName}",
      botName ?? "undefined"
    );

    message = message.replace(
      "{LINK_PRIVACY_POLICY}",
      `[Politique de confidentialité](${BotMessages.URL_PRIVACY_POLICY})`
    );
    message = message.replace(
      "{LINK_GCU}",
      `[Conditions générales d'utilisation](${BotMessages.URL_GCU})`
    );
    await session.sendMessage(message);

    // if "Bonjour JOEL ! Suivre ..." or "/start Suivre ..."
    if (messageSplit.length > 1 && messageSplit[1] !== "") {
      const commandMsg = messageSplit[1].trim();
      if (commandMsg.toLowerCase().startsWith("suivreo"))
        await session.log({ event: "/start-from-organisation" });
      else if (commandMsg.toLowerCase().startsWith("suivref"))
        await session.log({ event: "/start-from-tag" });
      else if (
        commandMsg.toLowerCase().startsWith("suiv") ||
        commandMsg.toLowerCase().startsWith("recherche")
      )
        await session.log({ event: "/start-from-people" });

      await processMessage(session, commandMsg);
    } else {
      //  start classique
      await session.log({ event: "/start" });
    }
  } catch (error) {
    console.log(error);
  }
};
