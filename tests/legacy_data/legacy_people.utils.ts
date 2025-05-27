import { Schema, Model, Types, model } from "mongoose";
import TelegramBot = require("node-telegram-bot-api");
import { JORFSearchItem } from "../../entities/JORFSearchResponse";

// Mark interfaces and types as internal to tests
interface TestLegacyIPeople {
  _id: Types.ObjectId;
  nom: string;
  prenom: string;
  lastKnownPosition: Object;
  save: () => Promise<TestLegacyIPeople>;
  countDocuments: () => any;
}

// Prefix with Test to make it clear it's for testing
const TestLegacyPeopleSchema = new Schema<
  TestLegacyIPeople,
  TestLegacyPeopleModel
>(
  {
    nom: {
      type: String,
      required: true,
    },
    prenom: {
      type: String,
      required: true,
    },
    lastKnownPosition: {
      type: Object,
      required: true,
    },
  },
  { timestamps: true },
);

// The db name is set to "People" to save legacy people records in the current People db
const TestLegacyPeople = model<TestLegacyIPeople, TestLegacyPeopleModel>(
  "People",
  TestLegacyPeopleSchema,
);

interface TestLegacyPeopleModel extends Model<TestLegacyIPeople> {
  firstOrCreate: (args: {
    tgPeople: TelegramBot.User | undefined;
    chatId: number;
  }) => Promise<TestLegacyIPeople>;
}

export async function TestSaveLegacyPerson(): Promise<{
  data: {
    nom: string;
    prenom: string;
    lastKnownPosition: Object;
  }; // raw data
  people: TestLegacyIPeople; // document
}> {
  const legacyPersonData = {
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

  const person = new TestLegacyPeople(legacyPersonData);
  const savedPerson = await person.save();
  return { data: legacyPersonData, people: savedPerson };
}
