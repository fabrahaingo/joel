import { ISession } from "../types.ts";
import { Keyboard, KEYBOARD_KEYS } from "../entities/Keyboard.ts";

export const defaultCommand = async (session: ISession): Promise<void> => {
  try {
    if (session.isReply) return;
    await session.log({ event: "/default-message" });
    await session.sendMessage("Je n'ai pas compris votre message 🥺");
  } catch (error) {
    console.log(error);
  }
};

export const mainMenuCommand = async (session: ISession): Promise<void> => {
  try {
    await session.log({ event: "/main-menu-message" });
    let message = "";

    let keyboard: Keyboard;
    if (session.messageApp === "Telegram") {
      message +=
        "Merci d'utiliser un des boutons ci-dessous pour interagir avec moi.";
    } else {
      message += "\n\n" + TEXT_COMMANDS_MENU;
      keyboard = [
        [KEYBOARD_KEYS.FOLLOWS_LIST.key],
        [KEYBOARD_KEYS.FUNCTION_FOLLOW.key],
        [KEYBOARD_KEYS.HELP.key]
      ];
    }
    await session.sendMessage(message, keyboard);
  } catch (error) {
    console.log(error);
  }
};

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
