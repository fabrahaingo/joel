import { BotMessages } from "../entities/BotMessages.ts";
import { ISession } from "../types.ts";
import Users from "../models/User.ts";
import People from "../models/People.ts";
import Organisation from "../models/Organisation.ts";
import { logError } from "../utils/debugLogger.ts";
import { getBuildInfo } from "../utils/buildInfo.ts";

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

  const statsTexts = await statsText(session);

  const fullText = helpText + "\\split" + statsTexts;

  await session.sendMessage(fullText, { separateMenuMessage: true });
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
  await session.log({ event: "/build" });
  await session.sendTypingAction();

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

const statsText = async (session: ISession): Promise<string> => {
  try {
    const usersCount = await Users.countDocuments();
    const signalCount = await Users.countDocuments({ messageApp: "Signal" });
    const WHCount = await Users.countDocuments({ messageApp: "WhatsApp" });
    const telegramCount = await Users.countDocuments({
      messageApp: "Telegram"
    });
    const matrixCount = await Users.countDocuments({
      messageApp: "Matrix"
    });
    const tchapCount = await Users.countDocuments({
      messageApp: "Tchap"
    });

    const peopleCount = await People.countDocuments();
    const orgCount = await Organisation.countDocuments();

    const followApps = [
      { app: "WhatsApp", count: WHCount },
      { app: "Signal", count: signalCount },
      { app: "Telegram", count: telegramCount },
      { app: "Matrix", count: matrixCount },
      { app: "Tchap", count: tchapCount }
    ].sort((a, b) => b.count - a.count);

    let msg = `📈 JOEL aujourd'hui c'est\n👨‍💻 ${String(usersCount)} utilisateurs\n`;

    for (const app of followApps)
      if (app.count > 0) msg += ` - ${String(app.count)} sur ${app.app}\n`;

    if (peopleCount > 0) msg += `🕵️ ${String(peopleCount)} personnes suivies\n`;

    if (orgCount > 0) msg += `🏛️ ${String(orgCount)} organisations suivies\n\n`;

    msg += `JOEL sait combien vous êtes à l'utiliser mais il ne sait pas qui vous êtes... et il ne cherchera jamais à le savoir! 🛡`;

    return msg;
  } catch (error) {
    await logError(session.messageApp, "Error in /help command", error);
  }
  return "";
};
