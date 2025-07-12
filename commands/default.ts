import { ISession } from "../types.js";
import { mainMenuKeyboard } from "../utils/keyboards.js";

export const defaultCommand = async (session: ISession): Promise<void> => {
  try {
    // only answer non-reply messages
    if (!session.isReply) {
      await session.log({ event: "/default-message" });
      await session.sendMessage(
        `Je n'ai pas compris votre message 🥺\nMerci d'utiliser un des boutons ci-dessous pour interagir avec moi.`,
        mainMenuKeyboard
      );
    }
  } catch (error) {
    console.log(error);
  }
};
