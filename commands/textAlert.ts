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
import {
  buildTextAlertKeywordSearchPlan,
  buildTextAlertSearchFilter
} from "../utils/textAlertSearch.utils.ts";

const TEXT_ALERT_PROMPT =
  "Quel texte souhaitez-vous rechercher ? Renseignez un mot ou une expression.";

const TEXT_RESULT_DISPLAY_LIMIT = 10;
const TEXT_RESULT_SEARCH_LIMIT = 100;
const TEXT_RESULT_COLLECT_LIMIT = TEXT_RESULT_SEARCH_LIMIT + 1;
const TEXT_FUZZY_CANDIDATE_MULTIPLIER = 15;
const TEXT_FUZZY_CANDIDATE_MAX = 1000;

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

  const yearsBack = getYearsBackSearch();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - yearsBack);

  const searchResult = await searchRecentPublicationsByKeywords(
    session.messageApp,
    trimmedAnswer,
    startDate
  );
  if (searchResult == null) {
    await session.sendMessage(
      "Une erreur est survenue lors de la recherche. Notre équipe a été prévenue."
    );
    return true;
  }

  const matchingPublications = searchResult.publications;

  let text = "";

  const hasResults = matchingPublications.length > 0;
  const totalMatches = matchingPublications.length;
  const hasMoreThan100 = searchResult.hasMore;

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
    // Explicit guard (rather than `??=`) so both branches are individually
    // covered; the awaited `??=` form also confuses v8 statement coverage.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    if (session.user == null) {
      session.user = await User.findOrCreate(session);
    }

    const alreadyFollowed = session.user.checkFollowedAlertString(
      context.alertString
    );
    await session.user.addFollowedAlertString(context.alertString);
    let responseText = `Vous suivez déjà une alerte pour *« ${context.alertString} »*. ✅`;
    if (!alreadyFollowed) {
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

type PublicationPreview = Pick<
  IPublication,
  "title" | "date" | "id" | "date_obj"
> & {
  normalizedTitle: string;
  normalizedTitleWords: string[];
};

function buildPublicationPreview(
  publication: IPublication
): PublicationPreview {
  let normalizedTitle: string;
  let normalizedTitleWords: string[];
  if (
    typeof publication.normalizedTitle === "string" &&
    Array.isArray(publication.normalizedTitleWords)
  ) {
    normalizedTitle = publication.normalizedTitle;
    normalizedTitleWords = publication.normalizedTitleWords;
  } else {
    normalizedTitle = normalizeFrenchTextWithStopwords(publication.title);
    normalizedTitleWords = normalizedTitle.split(" ").filter(Boolean);
  }

  return {
    title: publication.title,
    normalizedTitle,
    normalizedTitleWords,
    date: publication.date,
    id: publication.id,
    date_obj: publication.date_obj
  };
}

async function searchRecentPublicationsByKeywords(
  messageApp: MessageApp,
  query: string,
  startDate: Date
): Promise<{ publications: PublicationPreview[]; hasMore: boolean } | null> {
  try {
    const plan = buildTextAlertKeywordSearchPlan(query);
    const filter = buildTextAlertSearchFilter(plan, startDate);
    if (filter == null) {
      return {
        publications: [],
        hasMore: false
      };
    }

    const strictPublications: IPublication[] = await Publication.find(filter, {
      title: 1,
      id: 1,
      date: 1,
      date_obj: 1,
      normalizedTitle: 1,
      normalizedTitleWords: 1,
      _id: 0
    })
      .sort({ date_obj: -1 })
      // Fetch one extra record to know if there are more than the user-facing cap.
      .limit(TEXT_RESULT_COLLECT_LIMIT)
      .maxTimeMS(30000)
      .lean();

    const publicationsMap = new Map<string, PublicationPreview>();
    let fuzzyCandidateLimitReached = false;
    for (const publication of strictPublications) {
      const preview = buildPublicationPreview(publication);
      publicationsMap.set(preview.id, preview);
    }

    const fuzzyCandidateLimit = Math.min(
      TEXT_RESULT_SEARCH_LIMIT * TEXT_FUZZY_CANDIDATE_MULTIPLIER,
      TEXT_FUZZY_CANDIDATE_MAX
    );
    const broadCandidates: IPublication[] = await Publication.find(
      {
        date_obj: { $gte: startDate },
        normalizedTitleWords: { $in: plan.keywords }
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
      .limit(fuzzyCandidateLimit)
      .maxTimeMS(30000)
      .lean();
    fuzzyCandidateLimitReached = broadCandidates.length === fuzzyCandidateLimit;

    for (const publication of broadCandidates) {
      if (publicationsMap.has(publication.id)) continue;

      const preview = buildPublicationPreview(publication);

      if (
        !fuzzyIncludesNormalized(
          preview.normalizedTitle,
          plan.normalizedQuery,
          preview.normalizedTitleWords,
          plan.keywords
        )
      ) {
        continue;
      }

      if (publicationsMap.size >= TEXT_RESULT_COLLECT_LIMIT) {
        const oldestCollectedTimestamp = Math.min(
          ...Array.from(publicationsMap.values(), (result) =>
            result.date_obj.getTime()
          )
        );
        if (preview.date_obj.getTime() <= oldestCollectedTimestamp) {
          break;
        }
      }

      publicationsMap.set(preview.id, preview);
    }

    const collectedPublications = Array.from(publicationsMap.values()).sort(
      (a, b) => b.date_obj.getTime() - a.date_obj.getTime()
    );
    const hasMoreFromCollected =
      collectedPublications.length > TEXT_RESULT_SEARCH_LIMIT;
    const hasMoreDueToFuzzyCandidateLimit =
      !hasMoreFromCollected &&
      fuzzyCandidateLimitReached &&
      collectedPublications.length === TEXT_RESULT_SEARCH_LIMIT;
    const hasMore = hasMoreFromCollected || hasMoreDueToFuzzyCandidateLimit;
    return {
      publications: collectedPublications.slice(0, TEXT_RESULT_SEARCH_LIMIT),
      hasMore
    };
  } catch (error) {
    await logError(
      messageApp,
      "Failed to search publications by indexed keywords",
      error
    );
  }
  return null;
}
