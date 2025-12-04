import { ISession } from "../types.ts";
import { Keyboard, KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import {
  ExternalMessageOptions,
  MiniUserInfo,
  sendMessage
} from "../entities/Session.ts";
import umami from "../utils/umami.ts";
import { logError } from "../utils/debugLogger.ts";

export const defaultCommand = async (session: ISession): Promise<void> => {
  try {
    if (session.isReply) return;
    await session.log({ event: "/default-message" });
    await session.sendMessage("Je n'ai pas compris votre message 🥺", {
      separateMenuMessage: true
    });
  } catch (error) {
    await logError(session.messageApp, "Error in /default command", error);
  }
};

export const MAIN_MENU_MESSAGE = "Utilisez le clavier ci-dessous.";

export const mainMenuCommand = async (session: ISession): Promise<void> => {
  await session.log({ event: "/main-menu-message" });
  await sendMainMenu(
    {
      messageApp: session.messageApp,
      chatId: session.chatId,
      roomId: session.roomId
    },
    { session }
  );
};

export async function sendMainMenu(
  userInfo: MiniUserInfo,
  options: {
    externalOptions?: ExternalMessageOptions;
    session?: ISession;
  }
): Promise<void> {
  if (options.session == null && options.externalOptions == null)
    throw new Error("session or externalOptions is required");

  try {
    let message = MAIN_MENU_MESSAGE;
    let separateMenuMessage = undefined;

    let keyboard: Keyboard | undefined = undefined;
    switch (userInfo.messageApp) {
      case "Tchap":
      case "Matrix":
        separateMenuMessage = true;
        break;

      case "Telegram":
      case "WhatsApp":
        break;

      case "Signal":
        keyboard = [
          [KEYBOARD_KEYS.FOLLOWS_LIST.key],
          [KEYBOARD_KEYS.FUNCTION_FOLLOW.key],
          [KEYBOARD_KEYS.HELP.key]
        ];
        message += "\n\n" + TEXT_COMMANDS_MENU;
    }
    if (options.session != null)
      await options.session.sendMessage(message, {
        keyboard,
        separateMenuMessage
      });
    else if (options.externalOptions != null)
      await sendMessage(userInfo, message, {
        ...options.externalOptions,
        keyboard,
        separateMenuMessage
      });
  } catch (error) {
    await logError(userInfo.messageApp, "Error in /default command", error);
  }
}

const TEXT_COMMANDS_MENU = `Utilisez une des commandes suivantes pour interagir avec moi:
Format: *commande [arguments]*

Rechercher une personne:
*Rechercher Prénom Nom*

Suivre une personne:
*Suivre Prénom Nom*

Rechercher/Suivre une organisation:
*RechercherO Nom de l'organisation*
ou
*SuivreO OrganisationWikidataId*

Suivre des fonctions:
*Fonctions*

Lister/retirer les suivis:
*Suivis*

Ou utiliser l'un des boutons ci-dessous:`;
