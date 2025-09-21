import { ISession, IUser, MessageApp } from "../types.ts";
import { Keyboard, KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import { ExternalMessageOptions, sendMessage } from "../entities/Session.ts";

export const defaultCommand = async (session: ISession): Promise<void> => {
  try {
    if (session.isReply) return;
    await session.log({ event: "/default-message" });
    await session.sendMessage("Je n'ai pas compris votre message 🥺");
  } catch (error) {
    console.log(error);
  }
};

const MAIN_MENU_MESSAGE =
  "Utilisez un des boutons ci-dessous pour interagir avec moi.";

export const mainMenuCommand = async (session: ISession): Promise<void> => {
  await session.log({ event: "/main-menu-message" });
  await sendMainMenu(session.messageApp, session.chatId, { session });
};

export async function sendMainMenu(
  messageApp: MessageApp,
  chatId: IUser["chatId"],
  options: {
    externalOptions?: ExternalMessageOptions;
    session?: ISession;
  }
): Promise<void> {
  if (options.session == null && options.externalOptions == null)
    throw new Error("session or externalOptions is required");

  try {
    let message = MAIN_MENU_MESSAGE;

    let keyboard: Keyboard | undefined = undefined;
    switch (messageApp) {
      case "Telegram":
      case "WhatsApp":
        break;
      case "Matrix":
      case "Signal":
        keyboard = [
          [KEYBOARD_KEYS.FOLLOWS_LIST.key],
          [KEYBOARD_KEYS.FUNCTION_FOLLOW.key],
          [KEYBOARD_KEYS.HELP.key]
        ];
        message += "\n\n" + TEXT_COMMANDS_MENU;
    }
    if (options.session != null)
      await options.session.sendMessage(message, keyboard);
    else if (options.externalOptions != null)
      await sendMessage(messageApp, chatId, message, {
        ...options.externalOptions,
        keyboard
      });
  } catch (error) {
    console.log(error);
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
