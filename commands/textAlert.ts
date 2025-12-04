import User from "../models/User.ts";
import { askFollowUpQuestion } from "../entities/FollowUpManager.ts";
import { ISession, MessageApp } from "../types.ts";
import { KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import { Publication } from "../models/Publication.ts";
import { fuzzyIncludes } from "../utils/text.utils.ts";
import { getJORFTextLink } from "../utils/JORFSearch.utils.ts";
import { JORFSearchPublication } from "../entities/JORFSearchResponseMeta.ts";
import umami from "../utils/umami.ts";
import { logError } from "../utils/debugLogger.ts";

const TEXT_ALERT_PROMPT =
  "Quel texte souhaitez-vous rechercher ? Renseignez un mot ou une expression.";

async function askTextAlertQuestion(session: ISession): Promise<void> {
  await askFollowUpQuestion(session, TEXT_ALERT_PROMPT, handleTextAlertAnswer, {
    messageOptions: { keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]] }
  });
}

const TEXT_ALERT_CONFIRMATION_PROMPT = (alertString: string) =>
  `Confirmez-vous vouloir ajouter une alerte pour « ${alertString} » ? (Oui/Non)`;

async function handleTextAlertAnswer(
  session: ISession,
  answer: string
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer.length === 0) {
    await session.sendMessage(
      "Votre texte n'a pas été reconnu. Merci d'entrer un mot ou une expression.",
      { keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]] }
    );
    await askTextAlertQuestion(session);
    return true;
  }

  if (trimmedAnswer.startsWith("/")) {
    return false;
  }

  await session.sendMessage("Recherche en cours ...", {
    forceNoKeyboard: true
  });

  await session.sendTypingAction();

  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

  const recentPublications = await getRecentPublications(session.messageApp);
  if (recentPublications == null) {
    await session.sendMessage(
      "Une erreur est survenue lors de la recherche. Notre équipé a été prévenue."
    );
    return true;
  }

  const matchingPublications = recentPublications.filter((publication) =>
    fuzzyIncludes(publication.title, trimmedAnswer)
  );

  if (matchingPublications.length > 100) {
    await session.sendMessage(
      "Votre saisie est trop générale (plus de 100 textes correspondants sur les deux dernières années). Merci de préciser votre demande.",
      { keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]] }
    );
    await askTextAlertQuestion(session);
    return true;
  }

  let text = "";

  const hasResults = matchingPublications.length > 0;
  const previewLimit = Math.min(10, matchingPublications.length);

  text += hasResults
    ? `Voici les ${String(previewLimit)} textes les plus récents correspondant à « ${trimmedAnswer} » :\n\n`
    : `Aucun texte des deux dernières années ne correspond à « ${trimmedAnswer} ».\n\n`;

  for (let i = 0; i < previewLimit; i++) {
    const publication = matchingPublications[i];
    const publicationLink = getJORFTextLink(publication.id);
    text += `*${publication.date.replaceAll("-", "/")}*`;
    if (session.messageApp === "WhatsApp") {
      text += `\n${publicationLink}\n`;
    } else {
      text += ` - [Cliquer ici](${publicationLink})\n`;
    }
    text += `${publication.title}\n\n`;
  }

  if (hasResults && matchingPublications.length > previewLimit) {
    text += `${String(matchingPublications.length - previewLimit)} autres résultats ne sont pas affichés.\n\n`;
  }

  text += "\\split" + TEXT_ALERT_CONFIRMATION_PROMPT(trimmedAnswer);

  await askFollowUpQuestion(session, text, handleTextAlertConfirmation, {
    context: { alertString: trimmedAnswer },
    messageOptions: {
      keyboard: [
        [{ text: "✅ Oui" }, { text: "❌ Non" }],
        [KEYBOARD_KEYS.MAIN_MENU.key]
      ]
    }
  });

  return true;
}

async function handleTextAlertConfirmation(
  session: ISession,
  answer: string,
  context: { alertString: string }
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer.length === 0) {
    await session.sendMessage(
      "Votre réponse n'a pas été reconnue. Merci de répondre par Oui ou Non.",
      { keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]] }
    );
    await askFollowUpQuestion(
      session,
      TEXT_ALERT_CONFIRMATION_PROMPT(context.alertString),
      handleTextAlertConfirmation,
      {
        context,
        messageOptions: {
          keyboard: [
            [{ text: "✅ Oui" }, { text: "❌ Non" }],
            [KEYBOARD_KEYS.MAIN_MENU.key]
          ]
        }
      }
    );
    return true;
  }

  if (trimmedAnswer.startsWith("/")) {
    return false;
  }

  if (/oui/i.test(trimmedAnswer)) {
    session.user ??= await User.findOrCreate(session);

    const wasAdded = await session.user.addFollowedAlertString(
      context.alertString
    );
    const responseText = wasAdded
      ? `Alerte enregistrée pour « ${context.alertString} » ✅`
      : `Vous suivez déjà une alerte pour « ${context.alertString} ». ✅`;

    await session.sendMessage(responseText, {
      keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]]
    });
    return true;
  }

  if (/non/i.test(trimmedAnswer)) {
    await session.sendMessage("Ok, aucune alerte n'a été enregistrée. 👌", {
      keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]]
    });
    return true;
  }

  await session.sendMessage(
    "Votre réponse n'a pas été reconnue. Merci de répondre par Oui ou Non.",
    { keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]] }
  );
  await askFollowUpQuestion(
    session,
    TEXT_ALERT_CONFIRMATION_PROMPT(context.alertString),
    handleTextAlertConfirmation,
    {
      context,
      messageOptions: {
        keyboard: [
          [{ text: "✅ Oui" }, { text: "❌ Non" }],
          [KEYBOARD_KEYS.MAIN_MENU.key]
        ]
      }
    }
  );
  return true;
}

export const textAlertCommand = async (session: ISession): Promise<void> => {
  await session.log({ event: "/text-alert" });
  try {
    await session.sendTypingAction();
    await askTextAlertQuestion(session);
  } catch (error) {
    console.log(error);
    await session.log({ event: "/console-log" });
  }
};

interface PublicationPreview {
  title: string;
  date: string;
  id: string;
  date_obj: Date;
}

const ONE_WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

let cachedPublications: PublicationPreview[] | null = null;
let lastFetchedAt: number | null = null;
let inflightRefresh: Promise<PublicationPreview[]> | null = null;

async function refreshRecentPublications(): Promise<PublicationPreview[]> {
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

  const publications: JORFSearchPublication[] = await Publication.find(
    {
      date_obj: { $gte: twoYearsAgo }
    },
    { title: 1, id: 1, date: 1, date_obj: 1, _id: 0 }
  )
    .sort({ date_obj: -1 })
    .lean();

  cachedPublications = publications;
  lastFetchedAt = Date.now();

  return publications;
}

async function getRecentPublications(
  messageApp: MessageApp
): Promise<PublicationPreview[] | null> {
  try {
    const isCacheStale =
      !cachedPublications ||
      !lastFetchedAt ||
      Date.now() - lastFetchedAt > ONE_WEEK_IN_MS;

    if (!isCacheStale && cachedPublications != null) {
      return cachedPublications;
    }

    inflightRefresh ??= refreshRecentPublications().finally(() => {
      inflightRefresh = null;
    });

    return await inflightRefresh;
  } catch (error) {
    await logError(
      messageApp,
      "Failed to refresh recent publications cache",
      error
    );
  }
  return null;
}
