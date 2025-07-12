import { HelpMessages } from "../entities/BotMessages.js";
import { ISession } from "../types.js";
import { mainMenuKeyboard } from "../utils/keyboards.js";

export const helpCommand = async (session: ISession): Promise<void> => {
  await session.log({ event: "/help" });
  await session.sendTypingAction();
  const helpText = HelpMessages.DEFAULT.replace(
    "{chatId}",
    session.chatId.toString()
  );
  await session.sendMessage(helpText, mainMenuKeyboard);
};
