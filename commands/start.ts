import { ISession } from "../types.ts";
import { BotMessages } from "../entities/BotMessages.ts";
import { commands } from "./Commands.ts";

export const startCommand = async (
  session: ISession,
  message: string
): Promise<void> => {
  const messageSplit = message.split(/!|\/start/i);

  try {
    await session.sendTypingAction();

    const botName = process.env.BOT_NAME;
    const botChannel = process.env.BOT_CHANNEL;

    const mardownLink = session.messageApp === "Telegram";

    let message = BotMessages.START.replace(
      "{botName}",
      botName ?? "undefined"
    );

    if (mardownLink) {
      message = message.replace(
        "{LINK_PRIVACY_POLICY}",
        `[Politique de confidentialité](${BotMessages.URL_PRIVACY_POLICY})`
      );
      message = message.replace(
        "{LINK_GCU}",
        `[Conditions générales d'utilisation](${BotMessages.URL_GCU})`
      );
    } else {
      message = message.replace(
        "{LINK_PRIVACY_POLICY}",
        `Politique de confidentialité:\n${BotMessages.URL_PRIVACY_POLICY}`
      );
      message = message.replace(
        "{LINK_GCU}",
        `Conditions générales d'utilisation:\n${BotMessages.URL_GCU}`
      );
    }
    await session.sendMessage(message, session.mainMenuKeyboard);

    if (messageSplit.length > 1) {
      const commandMsg = messageSplit[1].trim();
      if (commandMsg.toLowerCase().startsWith("suivreo"))
        await session.log({ event: "/start-from-organisation" });
      else if (commandMsg.toLowerCase().startsWith("suivref"))
        await session.log({ event: "/start-from-tag" });
      else if (
        commandMsg.toLowerCase().startsWith("sui") ||
        commandMsg.toLowerCase().startsWith("recherche")
      )
        await session.log({ event: "/start-from-people" });

      for (const command of commands) {
        if (command.regex.test(commandMsg)) {
          // we delegate the command to the right function
          await command.action(session, commandMsg);
          return;
        }
      }

      // if "Bonjour JOEL ! Suivre ..." or "/start Suivre ..."
    } else {
      //  start classique
      await session.log({ event: "/start" });
    }
  } catch (error) {
    console.log(error);
  }
};
