import { HelpMessages } from "../entities/BotMessages.ts";
import { ISession } from "../types.ts";

export const helpCommand = async (session: ISession): Promise<void> => {
  await session.log({ event: "/help" });
  await session.sendTypingAction();
  let helpText = HelpMessages.DEFAULT.replace(
    "{chatId}",
    session.chatId.toString()
  );

  if (session.messageApp === "Telegram")
    helpText +=
      "\n\nSi vous souhaitez supprimer votre compte: utilisez la commande /supprimerCompte";
  await session.sendMessage(helpText, session.mainMenuKeyboard);
};
