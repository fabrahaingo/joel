import { BotMessages } from "../entities/BotMessages.ts";
import { ISession, MessageApp } from "../types.ts";
import { getBuildInfo } from "../utils/buildInfo.ts";
import { getStatsText } from "./stats.ts";

export const helpCommand = async (session: ISession): Promise<void> => {
  session.log({ event: "/help" });

  const helpText = getHelpText(session);

  const statsText = await getStatsText(session);

  const commandsText = getCommandsTexts(session.messageApp);

  const fullText = helpText + "\\split" + commandsText + "\\split" + statsText;

  await session.sendMessage(fullText, { separateMenuMessage: true });
};

export const getCommandsTexts = (messageApp: MessageApp): string => {
  const isTelegram = messageApp === "Telegram";

  let msg = "";

  msg += `Pour exporter vos suivis sur une autre messagerie: utilisez la commande ${isTelegram ? "/export" : "_Exporter_"}`;
  msg += "\n\n";
  msg += `Pour supprimer votre compte: utilisez la commande ${isTelegram ? "/supprimerCompte" : "_Supprimer_"}`;

  return msg;
};
export const getHelpText = (session: ISession): string => {
  let helpText = BotMessages.HELP.replace("{CHAT_ID}", session.chatId)
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
  session.log({ event: "/build" });
  session.sendTypingAction();

  const { uptime, commitHash, commitUrl } = await getBuildInfo();

  const commitText =
    commitHash == null
      ? "🔖 Commit: inconnu"
      : commitUrl == null
        ? `🔖 Commit: ${commitHash}`
        : `🔖 Commit: [${commitHash}](${commitUrl})`;

  const message = [
    "🏗️ Informations de build",
    `⏱️ Uptime: ${uptime}`,
    commitText
  ].join("\n");

  await session.sendMessage(message, { separateMenuMessage: true });
};
