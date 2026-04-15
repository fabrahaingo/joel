import { describe, expect, it } from "@jest/globals";
import {
  buildTextAlertKeywordSearchPlan,
  buildTextAlertSearchFilter
} from "../utils/textAlertSearch.utils.ts";

describe("textAlert indexed search planning", () => {
  it("keeps meaningful normalized keywords", () => {
    const plan = buildTextAlertKeywordSearchPlan(
      "Décret relatif à l'éducation nationale"
    );

    expect(plan.normalizedQuery).toContain("decret");
    expect(plan.keywords).toEqual(
      expect.arrayContaining(["decret", "relatif", "education", "nationale"])
    );
  });

  it("returns an empty plan when stopwords-only query is provided", () => {
    const plan = buildTextAlertKeywordSearchPlan("de la et ou");
    expect(plan.normalizedQuery).toBe("");
    expect(plan.keywords).toEqual([]);
  });

  it("deduplicates and limits long keyword lists deterministically", () => {
    const plan = buildTextAlertKeywordSearchPlan(
      "alpha beta gamma delta epsilon zeta eta theta iota alpha beta",
      5
    );
    expect(plan.keywords.length).toBe(5);
    expect(new Set(plan.keywords).size).toBe(plan.keywords.length);
  });

  it("builds a Mongo filter using date range and keyword all-match", () => {
    const startDate = new Date("2025-01-01T00:00:00.000Z");
    const plan = buildTextAlertKeywordSearchPlan("décret armement");
    const filter = buildTextAlertSearchFilter(plan, startDate);

    expect(filter).toEqual({
      date_obj: { $gte: startDate },
      normalizedTitleWords: { $all: plan.keywords }
    });
  });

  it("returns null filter for empty queries", () => {
    const startDate = new Date("2025-01-01T00:00:00.000Z");
    const plan = buildTextAlertKeywordSearchPlan("   ");
    const filter = buildTextAlertSearchFilter(plan, startDate);
    expect(filter).toBeNull();
  });
});
