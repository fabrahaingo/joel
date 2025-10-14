import { BotMessages } from "../entities/BotMessages.ts";
import { ISession } from "../types.ts";

export const helpCommand = async (session: ISession): Promise<void> => {
  await session.log({ event: "/help" });
  await session.sendTypingAction();

  let helpText = getHelpText(session);

  if (session.messageApp === "Telegram") {
    helpText +=
      "\n\nPour exporter vos suivis sur une autre messagerie: utilisez la commande /export";
    helpText +=
      "\n\nPour supprimer votre compte: utilisez la commande /supprimerCompte";
  } else {
    helpText +=
      "\n\nPour exporter vos suivis sur une autre messagerie: utilisez la commande *Exporter*";
  }

  await session.sendMessage(helpText, { separateMenuMessage: true });
};

export const getHelpText = (session: ISession): string => {
  let helpText = BotMessages.HELP.replace("{CHAT_ID}", String(session.chatId))
    .replace("{MESSAGE_APP}", session.messageApp)
    .replace(
      "{LINK_PRIVACY_POLICY}",
      `[Politique de confidentialité](${BotMessages.URL_PRIVACY_POLICY})`
    )
    .replace(
      "{LINK_GCU}",
      `[Conditions générales d'utilisation](${BotMessages.URL_GCU})`
    );

  let channelText = "";

  switch (session.messageApp) {
    case "Telegram":
      channelText = BotMessages.FOLLOW_TELEGRAM;
      break;
    case "WhatsApp":
      channelText = BotMessages.FOLLOW_WHATSAPP;
  }

  helpText = helpText.replace("{FOLLOW_CHANNEL}", channelText);

  return helpText;
};

export const buildInfoCommand = async (session: ISession): Promise<void> => {
  const message = "";

  await session.sendMessage(message, { separateMenuMessage: true });
};
