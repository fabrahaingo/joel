import { describe, expect, beforeEach, it } from "vitest";
import mongoose from "mongoose";
import Organisation from "../models/Organisation.ts";

describe("Organisation model", () => {
  beforeEach(async () => {
    if (!mongoose.connection.db)
      throw new Error("MongoDB connection not established");
    await mongoose.connection.db.dropDatabase();
  });

  describe("Schema validation", () => {
    it("creates an organisation with nom and wikidataId", async () => {
      const org = await Organisation.create({
        nom: "CNRS",
        wikidataId: "Q537458"
      });
      expect(org.nom).toBe("CNRS");
      expect(org.wikidataId).toBe("Q537458");
    });

    it("fails without required nom", async () => {
      await expect(
        Organisation.create({ wikidataId: "Q537458" })
      ).rejects.toThrow(/nom/);
    });

    it("fails without required wikidataId", async () => {
      await expect(Organisation.create({ nom: "CNRS" })).rejects.toThrow(
        /wikidataId/
      );
    });

    it("stores the wikidataId uppercased on direct create", async () => {
      const org = await Organisation.create({
        nom: "CNRS",
        wikidataId: "Q537458"
      });
      expect(org.wikidataId).toBe("Q537458");
    });
  });

  describe("findOrCreate", () => {
    it("creates a new organisation when none exists", async () => {
      const org = await Organisation.findOrCreate({
        nom: "CNRS",
        wikidataId: "Q537458"
      });
      expect(org.nom).toBe("CNRS");
      expect(org.wikidataId).toBe("Q537458");
      expect(await Organisation.countDocuments()).toBe(1);
    });

    it("returns existing organisation on second call (no duplicate)", async () => {
      await Organisation.findOrCreate({ nom: "CNRS", wikidataId: "Q537458" });
      await Organisation.findOrCreate({ nom: "CNRS", wikidataId: "Q537458" });
      expect(await Organisation.countDocuments()).toBe(1);
    });

    it("stores wikidataId uppercase", async () => {
      const org = await Organisation.findOrCreate({
        nom: "CNRS",
        wikidataId: "q537458"
      });
      expect(org.wikidataId).toBe("Q537458");
    });

    it("finds existing org by lowercase wikidataId", async () => {
      await Organisation.findOrCreate({
        nom: "CNRS",
        wikidataId: "Q537458"
      });
      await Organisation.findOrCreate({
        nom: "CNRS",
        wikidataId: "q537458"
      });
      expect(await Organisation.countDocuments()).toBe(1);
    });

    it("creates distinct organisations with different wikidataIds", async () => {
      await Organisation.findOrCreate({ nom: "CNRS", wikidataId: "Q537458" });
      await Organisation.findOrCreate({
        nom: "INRAE",
        wikidataId: "Q3152234"
      });
      expect(await Organisation.countDocuments()).toBe(2);
    });
  });
});
