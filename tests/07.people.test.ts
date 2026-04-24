import { describe, expect, beforeEach, it } from "@jest/globals";
import mongoose from "mongoose";
import People from "../models/People.ts";

describe("People model", () => {
  beforeEach(async () => {
    if (!mongoose.connection.db)
      throw new Error("MongoDB connection not established");
    await mongoose.connection.db.dropDatabase();
  });

  describe("Schema validation", () => {
    it("creates a person with nom and prenom", async () => {
      const person = await People.create({ nom: "Dupont", prenom: "Jean" });
      expect(person.nom).toBe("Dupont");
      expect(person.prenom).toBe("Jean");
      expect(person._id).toBeDefined();
    });

    it("fails without required nom", async () => {
      await expect(People.create({ prenom: "Jean" })).rejects.toThrow(/nom/);
    });

    it("fails without required prenom", async () => {
      await expect(People.create({ nom: "Dupont" })).rejects.toThrow(/prenom/);
    });
  });

  describe("findOrCreate", () => {
    it("creates a new person when none exists", async () => {
      const person = await People.findOrCreate({
        nom: "Dupont",
        prenom: "Jean"
      });
      expect(person.nom).toBe("Dupont");
      expect(person.prenom).toBe("Jean");
      expect(await People.countDocuments()).toBe(1);
    });

    it("returns existing person on second call (no duplicate)", async () => {
      const first = await People.findOrCreate({
        nom: "Dupont",
        prenom: "Jean"
      });
      const second = await People.findOrCreate({
        nom: "Dupont",
        prenom: "Jean"
      });
      expect(second._id.toString()).toBe(first._id.toString());
      expect(await People.countDocuments()).toBe(1);
    });

    it("is case-insensitive (strength 2 ignores case)", async () => {
      const first = await People.findOrCreate({
        nom: "Dupont",
        prenom: "Jean"
      });
      const second = await People.findOrCreate({
        nom: "DUPONT",
        prenom: "JEAN"
      });
      expect(second._id.toString()).toBe(first._id.toString());
      expect(await People.countDocuments()).toBe(1);
    });

    it("is case-insensitive for accented names too", async () => {
      const first = await People.findOrCreate({
        nom: "Dupont",
        prenom: "Élodie"
      });
      const second = await People.findOrCreate({
        nom: "Dupont",
        prenom: "ÉLODIE"
      });
      expect(second._id.toString()).toBe(first._id.toString());
      expect(await People.countDocuments()).toBe(1);
    });

    it("creates distinct people with different names", async () => {
      await People.findOrCreate({ nom: "Dupont", prenom: "Jean" });
      await People.findOrCreate({ nom: "Martin", prenom: "Alice" });
      expect(await People.countDocuments()).toBe(2);
    });
  });
});
