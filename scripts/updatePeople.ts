import "dotenv/config";
import People from "../models/People";
import umami from "../utils/umami";
import { mongodbConnect } from "../db";
import { callJORFSearchDay } from "../utils/JORFSearch.utils";

async function getUpdatedPeople() {
  // Fetch day data from JORFSearch
  const dailyUpdates = await callJORFSearchDay(new Date())

  // remove duplicate people (the ones who have the same nom and prenom)
  return dailyUpdates.filter(
      (person: { nom: any; prenom: any }, index: any, self: any[]) =>
          index ===
          self.findIndex((t) => t.nom === person.nom && t.prenom === person.prenom)
  );
}

async function getRelevantPeopleFromDb(list: any[]) {
  if (list.length === 0) return [];
  return await People.find(
    {
      $or: list.map((person) => ({
        nom: person.nom,
        prenom: person.prenom,
      })),
    },
    { _id: 1, prenom: 1, nom: 1 }
  );
}

async function updatePeople(updatedUsers: any[], relevantPeople: any[]) {
  let total = 0;
  for await (let user of updatedUsers) {
    for await (let person of relevantPeople) {
      if (person.prenom === user.prenom && person.nom === user.nom) {
        person.lastKnownPosition = user;
        await umami.log({ event: "/person-updated" });
        await person.save();

        total++;
      }
    }
  }
  return;
}

(async () => {
  await mongodbConnect();
  const updatedPeople = await getUpdatedPeople();
  const relevantPeople = await getRelevantPeopleFromDb(updatedPeople);
  await updatePeople(updatedPeople, relevantPeople);
  process.exit(0);
})();
