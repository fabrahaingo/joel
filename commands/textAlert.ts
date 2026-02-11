import User from "../models/User.ts";
import { askFollowUpQuestion } from "../entities/FollowUpManager.ts";
import { ISession, MessageApp, IUser } from "../types.ts";
import { KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import { IPublication, Publication } from "../models/Publication.ts";
import {
  fuzzyIncludesNormalized,
  levenshteinDistance,
  normalizeFrenchText,
  normalizeFrenchTextWithStopwords,
  parsePublicationTitle
} from "../utils/text.utils.ts";
import { getJORFTextLink } from "../utils/JORFSearch.utils.ts";
import { logError } from "../utils/debugLogger.ts";
import { dateToString } from "../utils/date.utils.ts";

const TEXT_ALERT_PROMPT =
  "Quel texte souhaitez-vous rechercher ? Renseignez un mot ou une expression.";

const TEXT_RESULT_DISPLAY_LIMIT = 10;
const TEXT_RESULT_SEARCH_LIMIT = 100;

// Configurable number of years to search back (default: 2 years)
// Can be overridden via TEXT_SEARCH_YEARS_BACK environment variable
function getYearsBackSearch(): number {
  const envValue = process.env.TEXT_SEARCH_YEARS_BACK;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 50) {
      return parsed;
    }
  }
  return 2; // Default to 2 years
}

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
  `Confirmez-vous vouloir ajouter une alerte pour *« ${alertString} »* ? (Oui/Non)`;

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

  void session.sendMessage("Recherche en cours ...", {
    forceNoKeyboard: true
  });
  session.sendTypingAction();

  // Normalize user query with stopword removal for better matching
  const normalizedAnswer = normalizeFrenchTextWithStopwords(trimmedAnswer);
  const normalizedAnswerWords = normalizedAnswer.split(" ").filter(Boolean);

  const yearsBack = getYearsBackSearch();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - yearsBack);

  const recentPublications = await getRecentPublications(
    session.messageApp,
    startDate
  );
  if (recentPublications == null) {
    await session.sendMessage(
      "Une erreur est survenue lors de la recherche. Notre équipe a été prévenue."
    );
    return true;
  }

  // Search for matching publications, stopping after TEXT_RESULT_SEARCH_LIMIT (100)
  const matchingPublications = recentPublications.reduce(
    (tab: PublicationPreview[], publication) => {
      // Stop searching after we've found enough matches
      if (tab.length >= TEXT_RESULT_SEARCH_LIMIT) return tab;
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

  let text = "";

  const hasResults = matchingPublications.length > 0;
  const totalMatches = matchingPublications.length;
  const hasMoreThan100 = totalMatches >= TEXT_RESULT_SEARCH_LIMIT;

  // Display only the first TEXT_RESULT_DISPLAY_LIMIT (10) results
  const previewLimit = Math.min(
    TEXT_RESULT_DISPLAY_LIMIT,
    matchingPublications.length
  );

  const sinceText = ` depuis ${String(yearsBack)} an${yearsBack > 1 ? "s" : ""} (${dateToString(startDate, "DMY").replaceAll("-", "/")})`;

  if (hasResults) {
    if (hasMoreThan100) {
      text +=
        `Plus de ${String(TEXT_RESULT_SEARCH_LIMIT)} textes correspondent à *« ${trimmedAnswer} »*` +
        sinceText;
      text += `\\split`;
      text += `Voici les ${String(previewLimit)} textes les plus récents :\n\n`;
    } else if (totalMatches > TEXT_RESULT_DISPLAY_LIMIT) {
      text +=
        `${String(totalMatches)} textes correspondent à *« ${trimmedAnswer} »*` +
        sinceText;
      text += `\\split`;
      text += `Voici les ${String(previewLimit)} textes les plus récents :\n\n`;
    } else {
      text += `Voici les ${String(previewLimit)} textes les plus récents correspondant à *« ${trimmedAnswer} »* :\n\n`;
    }
  } else {
    text += `Aucun texte ne correspond à *« ${trimmedAnswer} »*.` + sinceText;
    text += `\n\n`;
  }

  for (let i = 0; i < previewLimit; i++) {
    const publication = matchingPublications[i];
    const publicationLink = getJORFTextLink(publication.id);
    const { type, cleanedTitle } = parsePublicationTitle(publication.title);

    // Format: Date - Type - Link
    text += `*${publication.date.replaceAll("-", "/")}*`;
    text += ` - *${type}*`;
    if (session.messageApp === "WhatsApp") {
      text += ` - ${publicationLink}\n`;
    } else {
      text += ` - [Cliquer ici](${publicationLink})\n`;
    }

    // Format: ... cleaned_title
    if (cleanedTitle) {
      text += `... ${cleanedTitle}\n\n`;
    } else {
      text += `\n\n`;
    }
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
      text += `Vous suivez déjà l'expression *« ${existingFollow} »*. ✅`;
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
    text += `Vous suivez une expression proche : *« ${foundFollow} »*.\n\n`;
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
      `Erreur dans textAlert en cherchant l'expression "${trimmedAnswer}"`
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
    let responseText = `Vous suivez déjà une alerte pour *« ${context.alertString} »*. ✅`;
    if (wasAdded) {
      responseText = `Alerte enregistrée pour *« ${context.alertString} »* ✅`;
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
let lastStartDate: Date | null = null;
let inflightRefresh: Promise<PublicationPreview[]> | null = null;
let backgroundRefreshStarted = false;

async function refreshRecentPublications(
  startDate: Date
): Promise<PublicationPreview[]> {
  const publications: IPublication[] = await Publication.find(
    {
      date_obj: { $gte: startDate }
    },
    {
      title: 1,
      id: 1,
      date: 1,
      date_obj: 1,
      normalizedTitle: 1,
      normalizedTitleWords: 1,
      _id: 0
    }
  )
    .sort({ date_obj: -1 })
    .batchSize(5000)
    .maxTimeMS(60000)
    .lean();

  cachedPublications = publications.map((publication) => {
    // Use pre-computed normalized fields if both are available, otherwise compute them
    let normalizedTitle: string;
    let normalizedTitleWords: string[];

    if (publication.normalizedTitle && publication.normalizedTitleWords) {
      // Both fields exist, use them directly
      normalizedTitle = publication.normalizedTitle;
      normalizedTitleWords = publication.normalizedTitleWords;
    } else {
      // One or both fields missing, recompute both to ensure consistency
      normalizedTitle = normalizeFrenchTextWithStopwords(publication.title);
      normalizedTitleWords = normalizedTitle.split(" ").filter(Boolean);
    }

    return {
      ...publication,
      normalizedTitle,
      normalizedTitleWords
    };
  });
  lastFetchedAt = Date.now();
  lastStartDate = startDate;

  return cachedPublications;
}

async function getRecentPublications(
  messageApp: MessageApp,
  startDate: Date
): Promise<PublicationPreview[] | null> {
  BACKGROUND_LOG_APP = messageApp;
  try {
    // Check if cache is stale or if the date range has changed
    const dateRangeChanged =
      lastStartDate && lastStartDate.getTime() !== startDate.getTime();

    const isCacheStale =
      !cachedPublications ||
      !lastFetchedAt ||
      Date.now() - lastFetchedAt > META_REFRESH_TIME_MS ||
      dateRangeChanged;

    if (!isCacheStale && cachedPublications != null) {
      return cachedPublications;
    }

    inflightRefresh ??= refreshRecentPublications(startDate).finally(() => {
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
      // Always use the current configuration value
      const yearsBack = getYearsBackSearch();
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - yearsBack);

      inflightRefresh ??= refreshRecentPublications(startDate).finally(() => {
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
