require("dotenv").config();
import People from "../models/People";
import axios from "axios";
import umami from "../utils/umami";
import moment from "moment";
import { mongodbConnect } from "../db";

async function getUpdatedPeople() {
  const today = moment().format("DD-MM-YYYY");
  // const today = "18-02-2024";
  await umami.log({ event: "/jorfsearch-request-date" });
  let updatedPeople = await axios
    .get(`https://jorfsearch.steinertriples.ch/${today}?format=JSON`)
    .then((res) => res.data);
  // remove duplicate people (the ones who have the same nom and prenom)
  updatedPeople = updatedPeople.filter(
    (person: { nom: any; prenom: any }, index: any, self: any[]) =>
      index ===
      self.findIndex((t) => t.nom === person.nom && t.prenom === person.prenom)
  );
  return updatedPeople;
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
  await umami.log({ event: "/autom-update-people-start" });
  await mongodbConnect();
  const updatedPeople = await getUpdatedPeople();
  const relevantPeople = await getRelevantPeopleFromDb(updatedPeople);
  await updatePeople(updatedPeople, relevantPeople);
  await umami.log({ event: "/autom-update-people-end" });
  process.exit(0);
})();
