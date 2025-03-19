import { cleanJORFItems } from "../entities/JORFSearchResponse";
require("dotenv").config();
import People from "../models/People";
import axios from "axios";
import { FunctionTags } from "../entities/FunctionTags";
import umami from "../utils/umami";
import { mongodbConnect } from "../db";

async function getPeopleToAddOrUpdate() {
  const today = new Date().toLocaleDateString("fr-FR").split("/").join("-");
  // const today = "18-02-2024";
  let dailyUpdates = await axios
    .get(`https://jorfsearch.steinertriples.ch/${today}?format=JSON`)
    .then((res) => res.data);
  // remove duplicate people (the ones who have the same nom and prenom)
  dailyUpdates=cleanJORFItems(dailyUpdates);
  return dailyUpdates.filter(
    (contact: { nom: any; prenom: any }, index: any, self: any[]) =>
      index ===
      self.findIndex(
        (t) => t.nom === contact.nom && t.prenom === contact.prenom
      )
  );
}

// extracts the relevant tags from the daily updates
// format: {tag: [contacts], tag2: [contacts]}
async function extractRelevantTags(dailyUpdates: any[]) {
  let newObj: any = {};
  let tags = Object.values(FunctionTags);
  for (let contact of dailyUpdates) {
    for (let tag of tags) {
      if (contact.hasOwnProperty(tag)) {
        if (newObj[tag]) {
          newObj[tag].push(contact);
        } else {
          newObj[tag] = [contact];
        }
      }
    }
  }
  return newObj;
}

async function updateTags(tagsToUpdate: any) {
  let total = 0;
  for await (let tag of Object.keys(tagsToUpdate)) {
    for await (let contact of tagsToUpdate[tag]) {
      // check if the person already exists in the db
      let person = await People.findOne({
        nom: contact.nom,
        prenom: contact.prenom,
      });
      // if the person exists, update the lastKnownPosition
      if (person) {
        person.lastKnownPosition = contact;
        await person.save();
        total++;
        await umami.log({ event: "/person-updated" });
      }
      // if the person doesnt exist, create a new one
      else {
        const newPerson = new People({
          nom: contact.nom,
          prenom: contact.prenom,
          lastKnownPosition: contact,
        });
        await newPerson.save();
        total++;
        await umami.log({ event: "/person-added" });
      }
    }
  }
  return;
}

(async () => {
  await mongodbConnect();
  const dailyUpdates = await getPeopleToAddOrUpdate();
  const tagsToUpdate = await extractRelevantTags(dailyUpdates);
  await updateTags(tagsToUpdate);
  process.exit(0);
})();
