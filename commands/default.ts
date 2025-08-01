import { ISession } from "../types.ts";

export const defaultCommand = async (session: ISession): Promise<void> => {
  try {
    // only answer non-reply messages
    if (!session.isReply) {
      await session.log({ event: "/default-message" });

      let message = "Je n'ai pas compris votre message 🥺";
      if (session.messageApp === "Telegram") {
        message +=
          "\n\nMerci d'utiliser un des boutons ci-dessous pour interagir avec moi.";
        await session.sendMessage(message, session.mainMenuKeyboard);
      } else {
        await session.sendMessage(message);
        await showCommands(session);
      }
    }
  } catch (error) {
    console.log(error);
  }
};

export const showCommands = async (session: ISession) => {
  const text = `Utilisez une des commandes suivantes pour interagir avec moi:
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
  await session.sendMessage(text, [
    [
      { text: "🧐 Mes suivis" },
      { text: "👨‍💼 Ajout Fonction" },
      { text: "❓ Aide & Contact" }
    ]
  ]);
};
