import { HelpMessages } from "../entities/BotMessages";
import { ISession } from "../types";
import { mainMenuKeyboard } from "../utils/keyboards";

export const helpCommand = async (session: ISession, _msg: never): Promise<void> => {
  await session.log({ event: "/help" });
  await session.sendTypingAction();
  const helpText = HelpMessages.DEFAULT.replace("{chatId}", session.chatId.toString());
  await session.sendMessage(helpText, mainMenuKeyboard);
};
