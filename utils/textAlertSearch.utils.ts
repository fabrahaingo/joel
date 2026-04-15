import { QueryFilter } from "mongoose";
import { IPublication } from "../models/Publication.ts";
import { normalizeFrenchTextWithStopwords } from "./text.utils.ts";

const DEFAULT_MAX_KEYWORDS = 8;

export interface TextAlertKeywordSearchPlan {
  normalizedQuery: string;
  keywords: string[];
}

export function buildTextAlertKeywordSearchPlan(
  query: string,
  maxKeywords = DEFAULT_MAX_KEYWORDS
): TextAlertKeywordSearchPlan {
  const normalizedQuery = normalizeFrenchTextWithStopwords(query);

  if (normalizedQuery.length === 0) {
    return {
      normalizedQuery: "",
      keywords: []
    };
  }

  const seen = new Set<string>();
  const keywords = normalizedQuery
    .split(" ")
    .filter(Boolean)
    .filter((word) => {
      if (seen.has(word)) return false;
      seen.add(word);
      return true;
    });

  const selectedKeywords = keywords.slice(0, maxKeywords);

  return {
    normalizedQuery: selectedKeywords.join(" "),
    keywords: selectedKeywords
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
