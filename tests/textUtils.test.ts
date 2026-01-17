import { describe, expect, it } from "@jest/globals";
import {
  normalizeFrenchText,
  normalizeFrenchTextWithStopwords,
  parsePublicationTitle
} from "../utils/text.utils.ts";

describe("Text Utils - Stopwords and Title Parsing", () => {
  describe("normalizeFrenchTextWithStopwords", () => {
    it("should remove common French stopwords", () => {
      const text =
        "Arrêté du 15 janvier 2024 relatif à la promotion dans le corps des ingénieurs";
      const normalized = normalizeFrenchTextWithStopwords(text);

      // Should not contain common stopwords
      expect(normalized).not.toContain(" du ");
      expect(normalized).not.toContain(" de ");
      expect(normalized).not.toContain(" le ");
      expect(normalized).not.toContain(" la ");
      expect(normalized).not.toContain(" dans ");
      expect(normalized).not.toContain(" des ");

      // Should contain meaningful words
      expect(normalized).toContain("arrete");
      expect(normalized).toContain("relatif");
      expect(normalized).toContain("promotion");
      expect(normalized).toContain("corps");
      expect(normalized).toContain("ingenieurs");
    });

    it("should remove date-related words (numbers and months)", () => {
      const text = "Décret du 6 janvier 2024 fixant le taux";
      const normalized = normalizeFrenchTextWithStopwords(text);

      // Should not contain day number or month
      expect(normalized).not.toContain(" 6 ");
      expect(normalized).not.toContain("janvier");

      // Should keep the year (4 digits)
      expect(normalized).toContain("2024");

      // Should contain meaningful words
      expect(normalized).toContain("decret");
      expect(normalized).toContain("fixant");
      expect(normalized).toContain("taux");
    });

    it("should handle text without stopwords", () => {
      const text = "cybersécurité intelligence artificielle blockchain";
      const normalized = normalizeFrenchTextWithStopwords(text);

      expect(normalized).toContain("cybersecurite");
      expect(normalized).toContain("intelligence");
      expect(normalized).toContain("artificielle");
      expect(normalized).toContain("blockchain");
    });

    it("should return empty string for text with only stopwords", () => {
      const text = "du de la le dans les";
      const normalized = normalizeFrenchTextWithStopwords(text);

      expect(normalized).toBe("");
    });
  });

  describe("parsePublicationTitle", () => {
    it("should extract publication type and clean title", () => {
      const title =
        "Arrêté du 6 janvier 2026 fixant le taux de promotion dans le corps";
      const { type, cleanedTitle } = parsePublicationTitle(title);

      expect(type).toBe("Arrêté");
      expect(cleanedTitle).toBe("fixant le taux de promotion dans le corps");
      expect(cleanedTitle).not.toContain("du 6 janvier 2026");
    });

    it("should handle Décret titles", () => {
      const title = "Décret du 15 janvier 2024 relatif à la réforme";
      const { type, cleanedTitle } = parsePublicationTitle(title);

      expect(type).toBe("Décret");
      expect(cleanedTitle).toBe("relatif à la réforme");
    });

    it("should handle titles with different date formats", () => {
      const title1 = "Arrêté du 06/01/2026 portant nomination";
      const { type: type1, cleanedTitle: cleanedTitle1 } =
        parsePublicationTitle(title1);

      expect(type1).toBe("Arrêté");
      expect(cleanedTitle1).toBe("portant nomination");
      expect(cleanedTitle1).not.toContain("06/01/2026");
    });

    it("should handle titles with 'en date du' pattern", () => {
      const title = "Arrêté en date du 6 janvier 2026 fixant les conditions";
      const { type, cleanedTitle } = parsePublicationTitle(title);

      expect(type).toBe("Arrêté");
      expect(cleanedTitle).toBe("fixant les conditions");
    });

    it("should handle short titles", () => {
      const title = "Avis";
      const { type, cleanedTitle } = parsePublicationTitle(title);

      expect(type).toBe("Avis");
      expect(cleanedTitle).toBe("");
    });

    it("should preserve text after date is removed", () => {
      const title =
        "Ordonnance du 1er mars 2024 relative à la simplification du droit";
      const { type, cleanedTitle } = parsePublicationTitle(title);

      expect(type).toBe("Ordonnance");
      expect(cleanedTitle).toContain("relative à la simplification du droit");
    });
  });

  describe("Integration: Stopwords + Title Parsing", () => {
    it("should work together for realistic publication titles", () => {
      const title =
        "Arrêté du 6 janvier 2026 fixant le taux de promotion dans le corps des ingénieurs de l'armement";

      // Parse to extract type and cleaned title
      const { type, cleanedTitle } = parsePublicationTitle(title);
      expect(type).toBe("Arrêté");

      // Normalize with stopwords
      const normalized = normalizeFrenchTextWithStopwords(title);

      // Should not contain stopwords or date words
      expect(normalized).not.toContain(" du ");
      expect(normalized).not.toContain(" le ");
      expect(normalized).not.toContain(" de ");
      expect(normalized).not.toContain(" dans ");
      expect(normalized).not.toContain("janvier");

      // Should contain key terms
      expect(normalized).toContain("arrete");
      expect(normalized).toContain("fixant");
      expect(normalized).toContain("taux");
      expect(normalized).toContain("promotion");
      expect(normalized).toContain("corps");
      expect(normalized).toContain("ingenieurs");
      expect(normalized).toContain("armement");
    });
  });

  describe("Performance comparison", () => {
    it("stopword removal should reduce word count significantly", () => {
      const title =
        "Arrêté du 6 janvier 2026 relatif à la promotion dans le corps des ingénieurs de l'armement";

      const normalizedStandard = normalizeFrenchText(title);
      const normalizedWithStopwords = normalizeFrenchTextWithStopwords(title);

      const standardWordCount = normalizedStandard
        .split(" ")
        .filter(Boolean).length;
      const stopwordsWordCount = normalizedWithStopwords
        .split(" ")
        .filter(Boolean).length;

      // Should have significantly fewer words after stopword removal
      expect(stopwordsWordCount).toBeLessThan(standardWordCount);

      // Expect at least 40% reduction in word count
      const reduction =
        (standardWordCount - stopwordsWordCount) / standardWordCount;
      expect(reduction).toBeGreaterThanOrEqual(0.4);
    });
  });
});
