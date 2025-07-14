import { describe, expect } from "@jest/globals";
import People, { LegacyPeople_V1 } from "../models/People.ts";
import { IPeople } from "../types.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

describe("People Model Test Suite", () => {
  let mdb: typeof mongoose.connection.db;
  let mms: MongoMemoryServer;

  beforeAll(async () => {
    mms = await MongoMemoryServer.create();
    await mongoose.connect(mms.getUri(), {
      dbName: "jest"
    });
  });

  afterEach(async () => {
    if (!mdb) throw new Error("MongoDB connection not established");
    await mdb.dropDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mms.stop();
  });

  // Only need to be checked for the current user schema
  describe("Schema Validation", () => {
    const currentPersonData = {
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
      }
    };

    it("should insert a legacy people in the db and check if t", async () => {
      if (!mdb) throw new Error("MongoDB connection not established");
      await mdb.collection("people").insertOne(currentPersonData);
      const legacyPeople: IPeople | null = (await mdb
        .collection("people")
        .findOne({ _id: currentPersonData })) as IPeople | null;
      expect(legacyPeople).not.toBeNull();
      if (legacyPeople != null) {
        expect(await legacyPeople.validate()).toBe(true);
        expect(
          (legacyPeople as unknown as LegacyPeople_V1).lastKnownPosition
        ).toBeUndefined();
      }
    });

    it("should find and remove a person from its name", async () => {
      const people: IPeople | null = await People.findOne({
        nom: currentPersonData.nom,
        prenom: currentPersonData.prenom
      });
      expect(people).not.toBeNull();

      await People.deleteOne({
        nom: currentPersonData.nom,
        prenom: currentPersonData.prenom
      });
      expect(await People.countDocuments()).toBe(1); // Legacy user from 01.legacyUser.test
    });

    it("should fail without required nom", async () => {
      const invalidPerson = {
        prenom: currentPersonData.prenom
      };

      const person: IPeople = People.create(invalidPerson);
      await expect(person.save()).rejects.toThrow(/nom.*required/);
    });

    it("should fail without required prenom", async () => {
      const invalidPerson = {
        nom: currentPersonData.nom
      };

      const person: IPeople = People.create(invalidPerson);
      await expect(person.save()).rejects.toThrow(/prenom.*required/);
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
      describe(`Current People creation with firstOrCreate`, () => {
        it("should create a new person if not exists", async () => {
          const newPerson = {
            nom: "Dupont",
            prenom: "Jean",
            lastKnownPosition: mockJORFItem
          };

          const person: IPeople = await People.firstOrCreate(newPerson);

          expect(person.nom).toBe(newPerson.nom);
          expect(person.prenom).toBe(newPerson.prenom);

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
            listPersonsByDate = (await People.find({})).sort(
              (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
            );
          }
          existingPerson = listPersonsByDate[user_id];
        });

        it("should find person case-insensitively", async () => {
          expect(existingPerson).toBeDefined();

          const peopleCountBefore = await People.countDocuments();

          await People.create(existingPerson).save();

          const personCAPS = await People.firstOrCreate({
            nom: existingPerson.nom.toUpperCase(),
            prenom: existingPerson.prenom.toUpperCase()
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

  describe("Timestamps", () => {
    it("should set createdAt and updatedAt on creation", async () => {
      const person: IPeople = await People.create({
        nom: "Dupont",
        prenom: "Jean",
        lastKnownPosition: {
          source_date: "2023-01-01"
        }
      }).save();

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
      }).save();

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
