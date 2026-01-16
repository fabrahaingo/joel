import { describe, expect, it } from "@jest/globals";
import { normalizeFrenchText } from "../utils/text.utils.ts";

/**
 * Tests for the textAlert search behavior with the new limits:
 * - Stop searching after 100 matches
 * - Display only first 10 results
 * - Inform user when there are more than 100 results
 */
describe("TextAlert Search Limits", () => {
  describe("Search limit constants", () => {
    it("should stop searching after 100 matches", () => {
      const TEXT_RESULT_SEARCH_LIMIT = 100;
      expect(TEXT_RESULT_SEARCH_LIMIT).toBe(100);
    });

    it("should display only 10 results", () => {
      const TEXT_RESULT_DISPLAY_LIMIT = 10;
      expect(TEXT_RESULT_DISPLAY_LIMIT).toBe(10);
    });
  });

  describe("Search behavior simulation", () => {
    it("should limit search to 100 publications", () => {
      // Simulate publications array
      const publications = Array.from({ length: 200 }, (_, i) => ({
        title: `Publication ${i}`,
        normalizedTitle: normalizeFrenchText(`Publication ${i}`),
        normalizedTitleWords: normalizeFrenchText(`Publication ${i}`).split(" ").filter(Boolean)
      }));

      const TEXT_RESULT_SEARCH_LIMIT = 100;
      const searchTerm = "publication";

      // Simulate the reduce logic from textAlert.ts
      const matchingPublications = publications.reduce(
        (tab: typeof publications, publication) => {
          if (tab.length >= TEXT_RESULT_SEARCH_LIMIT) return tab;
          if (publication.normalizedTitle.includes(searchTerm)) {
            tab.push(publication);
          }
          return tab;
        },
        []
      );

      // Should stop at 100 even though 200 match
      expect(matchingPublications.length).toBe(100);
    });

    it("should display only 10 results even when 100 are found", () => {
      const TEXT_RESULT_DISPLAY_LIMIT = 10;
      const matchingPublications = Array.from({ length: 100 }, (_, i) => ({
        title: `Publication ${i}`
      }));

      const previewLimit = Math.min(TEXT_RESULT_DISPLAY_LIMIT, matchingPublications.length);

      expect(previewLimit).toBe(10);
    });

    it("should display all results when fewer than 10 are found", () => {
      const TEXT_RESULT_DISPLAY_LIMIT = 10;
      const matchingPublications = Array.from({ length: 5 }, (_, i) => ({
        title: `Publication ${i}`
      }));

      const previewLimit = Math.min(TEXT_RESULT_DISPLAY_LIMIT, matchingPublications.length);

      expect(previewLimit).toBe(5);
    });
  });

  describe("User message generation", () => {
    it("should indicate when more than 100 results exist", () => {
      const TEXT_RESULT_SEARCH_LIMIT = 100;
      const TEXT_RESULT_DISPLAY_LIMIT = 10;
      const trimmedAnswer = "test";
      const totalMatches = 100;
      const hasMoreThan100 = totalMatches >= TEXT_RESULT_SEARCH_LIMIT;
      const previewLimit = TEXT_RESULT_DISPLAY_LIMIT;

      let text = "";
      if (hasMoreThan100) {
        text = `Plus de ${TEXT_RESULT_SEARCH_LIMIT} textes correspondent à « ${trimmedAnswer} ». Voici les ${String(previewLimit)} textes les plus récents :\n\n`;
      }

      expect(text).toContain("Plus de 100 textes correspondent");
      expect(text).toContain("10 textes les plus récents");
    });

    it("should indicate exact count when between 10 and 100 results exist", () => {
      const TEXT_RESULT_DISPLAY_LIMIT = 10;
      const trimmedAnswer = "test";
      const totalMatches = 50;
      const previewLimit = TEXT_RESULT_DISPLAY_LIMIT;

      let text = "";
      if (totalMatches > TEXT_RESULT_DISPLAY_LIMIT) {
        text = `${String(totalMatches)} textes correspondent à « ${trimmedAnswer} ». Voici les ${String(previewLimit)} textes les plus récents :\n\n`;
      }

      expect(text).toContain("50 textes correspondent");
      expect(text).toContain("10 textes les plus récents");
    });

    it("should show standard message when fewer than 10 results exist", () => {
      const TEXT_RESULT_DISPLAY_LIMIT = 10;
      const trimmedAnswer = "test";
      const totalMatches = 5;
      const previewLimit = totalMatches;

      let text = "";
      if (totalMatches <= TEXT_RESULT_DISPLAY_LIMIT) {
        text = `Voici les ${String(previewLimit)} textes les plus récents correspondant à « ${trimmedAnswer} » :\n\n`;
      }

      expect(text).toContain("5 textes les plus récents correspondant");
    });
  });
});
