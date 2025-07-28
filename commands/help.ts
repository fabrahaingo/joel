import { HelpMessages } from "../entities/BotMessages.ts";
import { ISession } from "../types.ts";

export const helpCommand = async (session: ISession): Promise<void> => {
  await session.log({ event: "/help" });
  await session.sendTypingAction();
  const helpText = HelpMessages.DEFAULT.replace(
    "{chatId}",
    session.chatId.toString()
  );
  await session.sendMessage(helpText, session.mainMenuKeyboard);
};
