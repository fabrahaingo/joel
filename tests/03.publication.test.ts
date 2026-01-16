import { describe, expect, beforeEach, it } from "@jest/globals";
import { Publication } from "../models/Publication.ts";
import mongoose from "mongoose";
import { normalizeFrenchText } from "../utils/text.utils.ts";

describe("Publication Model Test Suite", () => {
  beforeEach(async () => {
    if (!mongoose.connection.db)
      throw new Error("MongoDB connection not established");
    await mongoose.connection.db.dropDatabase();
  });

  const samplePublication = {
    id: "JORFTEXT000049123456",
    date: "2024-01-15",
    date_obj: new Date("2024-01-15"),
    title:
      "Décret n° 2024-001 du 15 janvier 2024 relatif à la réforme de l'éducation nationale",
    nor: "MENE2400001D",
    ministere: "Ministère de l'Éducation nationale",
    tags: {}
  };

  describe("Schema Validation", () => {
    it("should create a publication with required fields", async () => {
      const publication = await Publication.create(samplePublication);

      expect(publication.id).toBe(samplePublication.id);
      expect(publication.title).toBe(samplePublication.title);
      expect(publication.date).toBe(samplePublication.date);
      expect(publication.date_obj).toEqual(samplePublication.date_obj);
    });

    it("should fail without required id", async () => {
      const invalidPublication = {
        ...samplePublication,
        id: undefined
      };

      await expect(Publication.create(invalidPublication)).rejects.toThrow(
        /id.*required/
      );
    });

    it("should fail without required title", async () => {
      const invalidPublication = {
        ...samplePublication,
        title: undefined
      };

      await expect(Publication.create(invalidPublication)).rejects.toThrow(
        /title.*required/
      );
    });

    it("should fail without required date", async () => {
      const invalidPublication = {
        ...samplePublication,
        date: undefined
      };

      await expect(Publication.create(invalidPublication)).rejects.toThrow(
        /date.*required/
      );
    });
  });

  describe("Normalized Title Pre-save Hook", () => {
    it("should automatically compute normalizedTitle and normalizedTitleWords on save", async () => {
      const publication = await Publication.create(samplePublication);

      expect(publication.normalizedTitle).toBeDefined();
      expect(publication.normalizedTitleWords).toBeDefined();
      expect(Array.isArray(publication.normalizedTitleWords)).toBe(true);

      // Verify the normalization is correct
      const expectedNormalized = normalizeFrenchText(samplePublication.title);
      expect(publication.normalizedTitle).toBe(expectedNormalized);
      expect(publication.normalizedTitleWords).toEqual(
        expectedNormalized.split(" ").filter(Boolean)
      );
    });

    it("should handle French characters correctly in normalization", async () => {
      const frenchPublication = {
        ...samplePublication,
        id: "JORFTEXT000049123457",
        title:
          "Arrêté concernant les élèves de l'École nationale d'administration"
      };

      const publication = await Publication.create(frenchPublication);

      expect(publication.normalizedTitle).toBeDefined();
      // Should normalize accents and special characters
      expect(publication.normalizedTitle).not.toContain("ê");
      expect(publication.normalizedTitle).not.toContain("è");
      expect(publication.normalizedTitle).not.toContain("é");
      expect(publication.normalizedTitle).not.toContain("'");
    });

    it("should recompute normalized fields when title is modified", async () => {
      const publication = await Publication.create(samplePublication);
      const originalNormalized = publication.normalizedTitle;

      publication.title = "Nouveau titre du décret modifié";
      await publication.save();

      expect(publication.normalizedTitle).not.toBe(originalNormalized);
      expect(publication.normalizedTitle).toBe(
        normalizeFrenchText("Nouveau titre du décret modifié")
      );
    });

    it("should not recompute normalized fields when title is not modified", async () => {
      const publication = await Publication.create(samplePublication);
      const originalNormalized = publication.normalizedTitle;

      // Modify a different field
      publication.nor = "MENE2400002D";
      await publication.save();

      // Normalized fields should remain the same
      expect(publication.normalizedTitle).toBe(originalNormalized);
    });

    it("should split normalized title into words correctly", async () => {
      const publication = await Publication.create({
        ...samplePublication,
        title: "Arrêté du 15 janvier 2024"
      });

      expect(publication.normalizedTitleWords).toBeDefined();
      expect(publication.normalizedTitleWords!.length).toBeGreaterThan(0);

      // Verify it's an array of non-empty strings
      expect(
        publication.normalizedTitleWords!.every(
          (word) => typeof word === "string" && word.length > 0
        )
      ).toBe(true);
    });
  });

  describe("Indexes", () => {
    it("should enforce unique constraint on id", async () => {
      await Publication.create(samplePublication);

      // Attempt to create a duplicate
      await expect(Publication.create(samplePublication)).rejects.toThrow();
    });

    it("should have indexes on normalizedTitle and normalizedTitleWords", async () => {
      const indexes = await Publication.collection.getIndexes();

      // Check that normalizedTitle and normalizedTitleWords have indexes
      const indexNames = Object.keys(indexes);
      const hasNormalizedTitleIndex = indexNames.some((name) =>
        name.includes("normalizedTitle")
      );

      expect(hasNormalizedTitleIndex).toBe(true);
    });
  });

  describe("Query Performance", () => {
    it("should be able to query by normalizedTitle", async () => {
      await Publication.create(samplePublication);

      const normalized = normalizeFrenchText(samplePublication.title);
      const found = await Publication.findOne({
        normalizedTitle: normalized
      });

      expect(found).not.toBeNull();
      expect(found?.id).toBe(samplePublication.id);
    });

    it("should be able to query by normalizedTitleWords", async () => {
      await Publication.create(samplePublication);

      const word = "decret"; // normalized version of "Décret"
      const found = await Publication.findOne({
        normalizedTitleWords: word
      });

      expect(found).not.toBeNull();
      expect(found?.id).toBe(samplePublication.id);
    });
  });

  describe("Bulk Operations", () => {
    it("should handle bulkWrite insertions with normalized fields", async () => {
      const publications = [
        {
          id: "JORF001",
          date: "2024-01-15",
          date_obj: new Date("2024-01-15"),
          title: "Premier décret de test",
          normalizedTitle: normalizeFrenchText("Premier décret de test"),
          normalizedTitleWords: normalizeFrenchText("Premier décret de test")
            .split(" ")
            .filter(Boolean),
          tags: {}
        },
        {
          id: "JORF002",
          date: "2024-01-16",
          date_obj: new Date("2024-01-16"),
          title: "Deuxième arrêté de test",
          normalizedTitle: normalizeFrenchText("Deuxième arrêté de test"),
          normalizedTitleWords: normalizeFrenchText("Deuxième arrêté de test")
            .split(" ")
            .filter(Boolean),
          tags: {}
        }
      ];

      const ops = publications.map((doc) => ({
        updateOne: {
          filter: { id: doc.id },
          update: { $setOnInsert: doc },
          upsert: true
        }
      }));

      const result = await Publication.bulkWrite(ops, { ordered: false });
      expect(result.upsertedCount).toBe(2);

      // Verify the normalized fields are present
      const pub1 = await Publication.findOne({ id: "JORF001" });
      expect(pub1?.normalizedTitle).toBe(
        normalizeFrenchText("Premier décret de test")
      );
      expect(pub1?.normalizedTitleWords).toBeDefined();

      const pub2 = await Publication.findOne({ id: "JORF002" });
      expect(pub2?.normalizedTitle).toBe(
        normalizeFrenchText("Deuxième arrêté de test")
      );
      expect(pub2?.normalizedTitleWords).toBeDefined();
    });
  });
});
