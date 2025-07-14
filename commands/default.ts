import { ISession } from "../types.ts";
import { mainMenuKeyboard } from "../utils/keyboards.ts";

export const defaultCommand = async (session: ISession): Promise<void> => {
  try {
    // only answer non-reply messages
    if (!session.isReply) {
      await session.log({ event: "/default-message" });

      let message = "Je n'ai pas compris votre message 🥺\n\n";

      if (session.messageApp === "Telegram") {
        message += `Merci d'utiliser un des boutons ci-dessous pour interagir avec moi.`;
      } else {
        message += `Utilisez une des commandes ci-dessous:
Rechercher Prénom Nom
Suivre Prénom Nom`;
      }
      await session.sendMessage(message, mainMenuKeyboard);
    }
  } catch (error) {
    console.log(error);
  }
};
