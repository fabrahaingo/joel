import { ISession, Keyboard } from "../types.ts";

export const mainMenuCommand = async (
  session: ISession,
  msg?: string,
  isErrorMessage = false
): Promise<void> => {
  try {
    let message = "";
    if (isErrorMessage) {
      await session.log({ event: "/default-message" });
      message += "Je n'ai pas compris votre message 🥺\n\n";
    } else await session.log({ event: "/main-menu-message" });

    let keyboard: Keyboard = [];
    message +=
      "Merci d'utiliser un des boutons ci-dessous pour interagir avec moi.";
    if (session.messageApp === "Telegram") {
      keyboard = session.mainMenuKeyboard;
    } else {
      message += "\n\n" + TEXT_COMMANDS_MENU;
      keyboard = [
        [{ text: "🧐 Mes suivis" }],
        [{ text: "👨‍💼 Ajout Fonction" }],
        [{ text: "❓ Aide & Contact" }]
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
