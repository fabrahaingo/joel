import { describe, expect } from "@jest/globals";
import People, { LegacyPeople_V1 } from "../models/People.ts";
import { IPeople } from "../types.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import mongoose from "mongoose";

describe("People Model Test Suite", () => {
  let mdb: typeof mongoose.connection.db;

  beforeAll(() => {
    mdb = mongoose.connection.db;
  });

  beforeEach(async () => {
    if (!mongoose.connection.db)
      throw new Error("MongoDB connection not established");
    await mongoose.connection.db.dropDatabase();
  });

  const legacyPersonData = {
    //_id: Types.ObjectId: not here as the record is inserted
    nom: "Macron",
    prenom: "Emmanuel",
    lastKnownPosition: {
      organisations: [
        {
          nom: "École nationale d'administration (ENA)",
          wikidata_id: "Q273579",
          etablissement_enseignement_superieur: "Q38723"
        }
      ],
      source_date: "1993-03-24",
      source_id: "JORFTEXT000000345548",
      source_name: "JORF",
      type_ordre: "nomination",
      date_debut: "1993-01-01",
      ecole: "true",
      eleve_ena: "1993-1995",
      sexe: "F",
      nom: "Macron",
      prenom: "Emmanuel"
    },
    createAt: Date.now(),
    updatedAt: Date.now()
  };

  const currentPersonData = {
    nom: "Macron",
    prenom: "Emmanuel"
  };

  // Only need to be checked for the current user schema
  describe("Schema Validation", () => {
    it("should insert a legacy People in the db and validate it use", async () => {
      if (!mdb) throw new Error("MongoDB connection not established");

      await People.collection.insertOne(legacyPersonData);
      const legacyPeople: IPeople | null = await People.findOne({
        nom: currentPersonData.nom,
        prenom: currentPersonData.prenom
      });
      expect(legacyPeople).not.toBeNull();
      if (legacyPeople != null) {
        await expect(legacyPeople.validate()).resolves.toBeUndefined(); // undefined = validation passed
        expect(
          (legacyPeople as unknown as LegacyPeople_V1).lastKnownPosition
        ).toBeUndefined();
      }
    });

    it("should find and remove a person from its name", async () => {
      await People.create(currentPersonData);
      const people: IPeople | null = await People.findOne({
        nom: currentPersonData.nom,
        prenom: currentPersonData.prenom
      });
      expect(people).not.toBeNull();

      await People.deleteOne({
        nom: currentPersonData.nom,
        prenom: currentPersonData.prenom
      });
      expect(await People.countDocuments()).toBe(0);
    });

    it("should fail without required nom", async () => {
      const invalidPerson = {
        prenom: currentPersonData.prenom
      };

      await expect(People.create(invalidPerson)).rejects.toThrow(
        /nom.*required/
      );
    });

    it("should fail without required prenom", async () => {
      const invalidPerson = {
        nom: currentPersonData.nom
      };

      await expect(People.create(invalidPerson)).rejects.toThrow(
        /prenom.*required/
      );
    });
  });

  const mockJORFItem: JORFSearchItem = {
    nom: "Michel",
    prenom: "Blanquer",
    source_date: "2023-01-01",
    source_id: "JORF123456",
    type_ordre: "nomination",
    source_name: "JORF",
    organisations: []
  };

  describe("Static Methods", () => {
    describe("firstOrCreate", () => {
      it("should create a new person if not exists", async () => {
        const newPerson = {
          nom: "Dupont",
          prenom: "Jean",
          lastKnownPosition: mockJORFItem
        };

        const person: IPeople = await People.firstOrCreate(newPerson);

        expect(person.nom).toBe(newPerson.nom);
        expect(person.prenom).toBe(newPerson.prenom);

        expect(await People.countDocuments()).toBe(1);
      });

      it("should find person case-insensitively", async () => {
        const existingPerson: IPeople = await People.create(currentPersonData);

        const personCAPS = await People.firstOrCreate({
          nom: currentPersonData.nom.toUpperCase(),
          prenom: currentPersonData.prenom.toUpperCase()
        });

        expect(await People.countDocuments()).toBe(1); // No new records

        expect(personCAPS._id).toEqual(existingPerson._id);
        expect(personCAPS.nom).toBe(existingPerson.nom);
        expect(personCAPS.prenom).toBe(existingPerson.prenom);
      });
    });

    describe("Timestamps", () => {
      it("should set createdAt and updatedAt on creation", async () => {
        const person: IPeople = await People.create({
          nom: "Dupont",
          prenom: "Jean",
          lastKnownPosition: {
            source_date: "2023-01-01"
          }
        });

        expect(person.createdAt).toBeInstanceOf(Date);
        expect(person.updatedAt).toBeInstanceOf(Date);
        expect(person.createdAt).toEqual(person.updatedAt);
      });

      it("should update only updatedAt on modification", async () => {
        const person: IPeople = await People.create({
          nom: "Dupont",
          prenom: "Jean",
          lastKnownPosition: {
            source_date: "2023-01-01"
          }
        });

        const createdAt = person.createdAt;

        // Wait a bit to ensure different timestamp
        await new Promise((resolve) => setTimeout(resolve, 1000));

        person.nom = "Durant";
        await person.save();

        expect(person.createdAt).toEqual(createdAt);
        expect(person.updatedAt.getTime()).toBeGreaterThan(
          person.createdAt.getTime()
        );
      });
    });
  });
});
