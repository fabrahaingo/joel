import { FilterQuery } from "mongoose";
import { IPublication } from "../models/Publication.ts";
import {
  normalizeFrenchText,
  normalizeFrenchTextWithStopwords
} from "./text.utils.ts";

const DEFAULT_MAX_KEYWORDS = 8;

export interface TextAlertKeywordSearchPlan {
  normalizedQuery: string;
  keywords: string[];
}

export function buildTextAlertKeywordSearchPlan(
  query: string,
  maxKeywords = DEFAULT_MAX_KEYWORDS
): TextAlertKeywordSearchPlan {
  const normalizedWithStopwords = normalizeFrenchTextWithStopwords(query);
  const normalizedFallback = normalizeFrenchText(query);

  const baseQuery =
    normalizedWithStopwords.length > 0
      ? normalizedWithStopwords
      : normalizedFallback;

  const seen = new Set<string>();
  const keywords = baseQuery
    .split(" ")
    .filter(Boolean)
    .filter((word) => {
      if (seen.has(word)) return false;
      seen.add(word);
      return true;
    });

  if (keywords.length <= maxKeywords) {
    return {
      normalizedQuery: baseQuery,
      keywords
    };
  }

  const rankedKeywords = keywords
    .map((word, index) => ({ word, index }))
    .sort((a, b) => b.word.length - a.word.length || a.index - b.index)
    .slice(0, maxKeywords)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.word);

  return {
    normalizedQuery: baseQuery,
    keywords: rankedKeywords
  };
}

export function buildTextAlertSearchFilter(
  plan: TextAlertKeywordSearchPlan,
  startDate: Date
): FilterQuery<IPublication> | null {
  if (plan.keywords.length === 0) return null;

  return {
    date_obj: { $gte: startDate },
    normalizedTitleWords: { $all: plan.keywords }
  };
}
