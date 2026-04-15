import { QueryFilter } from "mongoose";
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

  if (normalizedWithStopwords.length === 0) {
    normalizeFrenchText(query);

    return {
      normalizedQuery: "",
      keywords: []
    };
  }

  const baseQuery = normalizedWithStopwords;
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

  return {
    normalizedQuery: baseQuery,
    keywords: keywords.slice(0, maxKeywords)
  };
}

export function buildTextAlertSearchFilter(
  plan: TextAlertKeywordSearchPlan,
  startDate: Date
): QueryFilter<IPublication> | null {
  if (plan.keywords.length === 0) return null;

  return {
    date_obj: { $gte: startDate },
    normalizedTitleWords: { $all: plan.keywords }
  };
}
