import { expect } from "@jest/globals";
import { TestSaveLegacyPerson } from "./legacy_data/legacy_people.utils";

// Delete the legacy people model to prevent OverwriteModelError
/*
afterAll(async () => {
  mongoose.deleteModel("People");
});
*/

describe("Legacy people saving", () => {
  it("should save a legacy person in the db", async () => {
    const legacyPerson = await TestSaveLegacyPerson();

    expect(legacyPerson.people.nom).toBe(legacyPerson.data.nom);
    expect(legacyPerson.people.prenom).toBe(legacyPerson.data.prenom);
    expect(legacyPerson.people.lastKnownPosition).toEqual(
      legacyPerson.data.lastKnownPosition,
    );
  });
});
