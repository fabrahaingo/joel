import User from "../models/User.ts";
import { askFollowUpQuestion } from "../entities/FollowUpManager.ts";
import { ISession, MessageApp, IUser } from "../types.ts";
import { KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import { Publication } from "../models/Publication.ts";
import {
  fuzzyIncludesNormalized,
  levenshteinDistance,
  normalizeFrenchText
} from "../utils/text.utils.ts";
import { getJORFTextLink } from "../utils/JORFSearch.utils.ts";
import { JORFSearchPublication } from "../entities/JORFSearchResponseMeta.ts";
import { logError } from "../utils/debugLogger.ts";

const TEXT_ALERT_PROMPT =
  "Quel texte souhaitez-vous rechercher ? Renseignez un mot ou une expression.";

const TEXT_RESULT_MAX = 5;

const twoYearsAgo = new Date();
twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

function findFollowedAlertString(
  user: IUser,
  alertString: string
): { existingFollow?: string; compatibleFollow?: string } {
  const normalizedQuery = normalizeFrenchText(alertString);
  if (normalizedQuery.length === 0) return {};

  const compatibleCandidates: string[] = [];

  for (const follow of user.followedMeta) {
    const normalizedFollow = normalizeFrenchText(follow.alertString);
    if (normalizedFollow === normalizedQuery) {
      return { existingFollow: follow.alertString };
    }

    const distance = levenshteinDistance(normalizedFollow, normalizedQuery);
    const maxLength = Math.max(normalizedFollow.length, normalizedQuery.length);
    const allowedDistance = Math.max(1, Math.round(maxLength * 0.2));

    if (
      normalizedFollow.includes(normalizedQuery) ||
      normalizedQuery.includes(normalizedFollow) ||
      distance <= allowedDistance
    ) {
      compatibleCandidates.push(follow.alertString);
    }
  }

  return { compatibleFollow: compatibleCandidates[0] };
}

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
  session.sendTypingAction();

  const normalizedAnswer = normalizeFrenchText(trimmedAnswer);
  const normalizedAnswerWords = normalizedAnswer.split(" ").filter(Boolean);

  const recentPublications = await getRecentPublications(session.messageApp);
  if (recentPublications == null) {
    await session.sendMessage(
      "Une erreur est survenue lors de la recherche. Notre équipé a été prévenue."
    );
    return true;
  }

  const matchingPublications = recentPublications.reduce(
    (tab: PublicationPreview[], publication) => {
      if (tab.length >= TEXT_RESULT_MAX) return tab;
      if (
        fuzzyIncludesNormalized(
          publication.normalizedTitle,
          normalizedAnswer,
          publication.normalizedTitleWords,
          normalizedAnswerWords
        )
      )
        tab.push(publication);
      return tab;
    },
    []
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
  const previewLimit = Math.min(TEXT_RESULT_MAX, matchingPublications.length);

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

  text += "\\split";

  let foundFollow: string | undefined = undefined;
  if (session.user != null) {
    const { existingFollow, compatibleFollow } = findFollowedAlertString(
      session.user,
      trimmedAnswer
    );
    foundFollow = compatibleFollow;
    if (existingFollow != null) {
      text += `Vous suivez déjà l'expression « ${existingFollow} ». ✅`;
      await session.sendMessage(text, {
        keyboard: [
          [KEYBOARD_KEYS.TEXT_SEARCH.key],
          [KEYBOARD_KEYS.MAIN_MENU.key]
        ]
      });
      return true;
    }
  }
  if (foundFollow != undefined) {
    text += `Vous suivez une expression proche : « ${foundFollow} ».\n\n`;
  }

  text += TEXT_ALERT_CONFIRMATION_PROMPT(trimmedAnswer);

  const res = await askFollowUpQuestion(
    session,
    text,
    handleTextAlertConfirmation,
    {
      context: { alertString: trimmedAnswer },
      messageOptions: {
        keyboard: [
          [{ text: "✅ Oui" }, { text: "❌ Non" }],
          [KEYBOARD_KEYS.MAIN_MENU.key]
        ]
      }
    }
  );

  if (!res) {
    await session.sendMessage(
      "Une erreur est survenue. Veuillez réessayer ultérieurement."
    );
    await logError(
      session.messageApp,
      `Erreur dans textAlert en cherchant l'expression ${trimmedAnswer}`
    );
  }

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
    let responseText = `Vous suivez déjà une alerte pour « ${context.alertString} ». ✅`;
    if (wasAdded) {
      responseText = `Alerte enregistrée pour « ${context.alertString} » ✅`;
      session.log({ event: "/follow-meta" });
    }

    await session.sendMessage(responseText, {
      keyboard: [[KEYBOARD_KEYS.TEXT_SEARCH.key], [KEYBOARD_KEYS.MAIN_MENU.key]]
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
  session.log({ event: "/text-alert" });
  try {
    session.sendTypingAction();
    await askTextAlertQuestion(session);
  } catch (error) {
    await logError(session.messageApp, "Error in textAlertCommand", error);
  }
};

interface PublicationPreview {
  title: string;
  normalizedTitle: string;
  normalizedTitleWords: string[];
  date: string;
  id: string;
  date_obj: Date;
}

// 4 hours
const META_REFRESH_TIME_MS = 4 * 60 * 60 * 1000;
let BACKGROUND_LOG_APP: MessageApp = "Tchap";

let cachedPublications: PublicationPreview[] | null = null;
let lastFetchedAt: number | null = null;
let inflightRefresh: Promise<PublicationPreview[]> | null = null;
let backgroundRefreshStarted = false;

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

  cachedPublications = publications.map((publication) => {
    const normalizedTitle = normalizeFrenchText(publication.title);
    return {
      ...publication,
      normalizedTitle,
      normalizedTitleWords: normalizedTitle.split(" ").filter(Boolean)
    };
  });
  lastFetchedAt = Date.now();

  return cachedPublications;
}

async function getRecentPublications(
  messageApp: MessageApp
): Promise<PublicationPreview[] | null> {
  BACKGROUND_LOG_APP = messageApp;
  try {
    const isCacheStale =
      !cachedPublications ||
      !lastFetchedAt ||
      Date.now() - lastFetchedAt > META_REFRESH_TIME_MS;

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

function startBackgroundRefresh(): void {
  if (backgroundRefreshStarted) return;

  const refreshAndHandleError = async (): Promise<void> => {
    try {
      inflightRefresh ??= refreshRecentPublications().finally(() => {
        inflightRefresh = null;
      });

      await inflightRefresh;
    } catch (error) {
      await logError(
        BACKGROUND_LOG_APP,
        "Failed to refresh recent publications cache in background",
        error
      );
    }
  };

  // Prime the cache immediately, then keep it warm at the same interval as manual refreshes.
  void refreshAndHandleError();
  setInterval(() => void refreshAndHandleError(), META_REFRESH_TIME_MS);

  backgroundRefreshStarted = true;
}

startBackgroundRefresh();
