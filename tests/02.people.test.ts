import { describe, expect } from "@jest/globals";
import People from "../models/People";
import { IPeople } from "../types";
import { JORFSearchItem } from "../entities/JORFSearchResponse";
import { dbHelper } from "./dbHelper";

describe("People Model Test Suite", () => {
  beforeAll(async () => {
    await dbHelper.setup();

    await dbHelper.reboot(); // This reload the legacy users from the DB
  });

  // Only need to be checked for the current user schema
  describe("Schema Validation", () => {
    const currentPersonData = {
      nom: "Macron",
      prenom: "Emmanuel",
      lastKnownPosition: {
        organisations: [
          {
            nom: "École nationale d'administration (ENA)",
            wikidata_id: "Q273579",
            etablissement_enseignement_superieur: "Q38723",
          },
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
        prenom: "Emmanuel",
      },
    };

    it("should create a valid person", async () => {
      const person: IPeople = new People(currentPersonData);
      const savedPerson: IPeople = await person.save();

      expect(savedPerson.nom).toBe(currentPersonData.nom);
      expect(savedPerson.prenom).toBe(currentPersonData.prenom);
      expect(savedPerson.lastKnownPosition).toEqual(
        currentPersonData.lastKnownPosition,
      );
      // expect(savedPerson.createdAt).toBeDefined();
      // expect(savedPerson.updatedAt).toBeDefined();
    });

    it("should find and remove a person from its name", async () => {
      const people: IPeople | null = await People.findOne({
        nom: currentPersonData.nom,
        prenom: currentPersonData.prenom,
      });
      expect(people).not.toBeNull();

      await People.deleteOne({
        nom: currentPersonData.nom,
        prenom: currentPersonData.prenom,
      });
      expect(await People.countDocuments()).toBe(1); // Legacy user from 01.legacyUser.test
    });

    it("should fail without required nom", async () => {
      const invalidPerson = {
        prenom: currentPersonData.prenom,
        lastKnownPosition: currentPersonData.lastKnownPosition,
      };

      const person: IPeople = new People(invalidPerson);
      await expect(person.save()).rejects.toThrow(/nom.*required/);
    });

    it("should fail without required prenom", async () => {
      const invalidPerson = {
        nom: currentPersonData.nom,
        lastKnownPosition: currentPersonData.lastKnownPosition,
      };

      const person: IPeople = new People(invalidPerson);
      await expect(person.save()).rejects.toThrow(/prenom.*required/);
    });

    it("should fail without required lastKnownPosition", async () => {
      const invalidPerson = {
        nom: currentPersonData.nom,
        prenom: currentPersonData.prenom,
      };

      const person: IPeople = new People(invalidPerson);
      await expect(person.save()).rejects.toThrow(
        /lastKnownPosition.*required/,
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
    organisations: [],
  };

  describe("Static Methods", () => {
    describe("firstOrCreate", () => {
      describe(`Current People creation with firstOrCreate`, () => {
        it("should create a new person if not exists", async () => {
          const newPerson = {
            nom: "Dupont",
            prenom: "Jean",
            lastKnownPosition: mockJORFItem,
          };

          const person: IPeople = await People.firstOrCreate(newPerson);

          expect(person.nom).toBe(newPerson.nom);
          expect(person.prenom).toBe(newPerson.prenom);
          expect(person.lastKnownPosition).toEqual(newPerson.lastKnownPosition);

          expect(await People.countDocuments()).toBe(2); // Legacy user from 01.legacyUser.test + currentUser
        });
      });
    });

    ["Legacy", "Current"].forEach((person_gen, user_id) => {
      let listPersonsByDate: IPeople[] = [];
      let existingPerson: IPeople;

      describe(`${person_gen} People firstOrCreate`, () => {
        beforeEach(async () => {
          if (listPersonsByDate.length === 0) {
            listPersonsByDate = await People.find().sort({ createdAt: 1 });
          }
          existingPerson = listPersonsByDate[user_id];
        });

        it("should update lastKnownPosition if person exists without one", async () => {
          expect(existingPerson).toBeDefined();
          const existingPersonDocument = await People.findById(
            existingPerson._id,
          );
          expect(existingPersonDocument).toBeDefined();

          const lastPos = existingPersonDocument.lastKnownPosition;

          const peopleCountBefore = await People.countDocuments();

          existingPersonDocument.lastKnownPosition = null;
          await existingPersonDocument.save({ validateBeforeSave: false });
          expect(existingPersonDocument.lastKnownPosition).toBeNull(); // make sure the position is gone

          const updatedPerson: IPeople = await People.firstOrCreate({
            nom: existingPerson.nom,
            prenom: existingPerson.prenom,
            lastKnownPosition: lastPos,
          });

          const peopleCountAfter = await People.countDocuments();
          expect(peopleCountAfter).toBe(peopleCountBefore);

          expect(updatedPerson._id).toEqual(existingPerson._id);
          expect(updatedPerson.nom).toEqual(existingPerson.nom);
          expect(updatedPerson.prenom).toEqual(existingPerson.prenom);
          expect(updatedPerson.lastKnownPosition).toEqual(lastPos);
        });

        it("should return existing person if found with different lastKnownPosition", async () => {
          expect(existingPerson).toBeDefined();

          const peopleCountBefore = await People.countDocuments();

          // Try to create the same person again with different lastKnownPosition
          const newPosition: JORFSearchItem = {
            ...mockJORFItem,
            source_id: "JORF789012",
          };
          const newPerson: IPeople = await People.firstOrCreate({
            nom: existingPerson.nom,
            prenom: existingPerson.prenom,
            lastKnownPosition: newPosition,
          });

          const peopleCountAfter = await People.countDocuments();
          expect(peopleCountAfter).toBe(peopleCountBefore);
          expect(newPerson._id).toEqual(existingPerson._id);
        });

        it("should find person case-insensitively", async () => {
          expect(existingPerson).toBeDefined();

          const peopleCountBefore = await People.countDocuments();

          await new People(existingPerson).save();

          const personCAPS = await People.firstOrCreate({
            nom: existingPerson.nom.toUpperCase(),
            prenom: existingPerson.prenom.toUpperCase(),
            lastKnownPosition: existingPerson.lastKnownPosition,
          });

          const peopleCountAfter = await People.countDocuments();
          expect(peopleCountAfter).toBe(peopleCountBefore);

          expect(personCAPS._id).toEqual(existingPerson._id);
          expect(personCAPS.nom).toBe(existingPerson.nom);
          expect(personCAPS.prenom).toBe(existingPerson.prenom);
        });
      });
    });
  });

  // The timestamps tests require defining the timestamps in the IPeople/People types/interfaces
  // This is not the case with the current schema, so they are commented out for now
  /*
    describe("Timestamps", () => {
      it("should set createdAt and updatedAt on creation", async () => {
        const person = await new People({
          nom: "Dupont",
          prenom: "Jean",
          lastKnownPosition: {
            source_date: "2023-01-01",
          },
        }).save();

        expect(person.createdAt).toBeInstanceOf(Date);
        expect(person.updatedAt).toBeInstanceOf(Date);
        expect(person.createdAt).toEqual(person.updatedAt);
      });

    it("should update only updatedAt on modification", async () => {
      const person = await new People({
        nom: "Dupont",
        prenom: "Jean",
        lastKnownPosition: {
          source_date: "2023-01-01",
        },
      }).save();

      const createdAt = person.createdAt;

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 1000));

      person.nom = "Durant";
      await person.save();

      expect(person.createdAt).toEqual(createdAt);
      expect(person.updatedAt.getTime()).toBeGreaterThan(
        person.createdAt.getTime(),
      );
    });

  });

    */
});
