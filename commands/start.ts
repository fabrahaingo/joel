import { ISession } from "../types.ts";
import { BotMessages } from "../entities/BotMessages.ts";

export const startCommand = async (session: ISession): Promise<void> => {
  await session.log({ event: "/start" });
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
  } catch (error) {
    console.log(error);
  }
};
