import { ISession } from "../types.ts";

export const defaultCommand = async (session: ISession): Promise<void> => {
  try {
    // only answer non-reply messages
    if (!session.isReply) {
      await session.log({ event: "/default-message" });

      const message =
        "Je n'ai pas compris votre message 🥺\n\nMerci d'utiliser un des boutons ci-dessous pour interagir avec moi.";
      await session.sendMessage(message, session.mainMenuKeyboard);
    }
  } catch (error) {
    console.log(error);
  }
};
