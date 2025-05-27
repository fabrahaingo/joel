import { Schema as _Schema, model } from "mongoose";
import { IPeople, PeopleModel } from "../types";
import { JORFSearchItem } from "../entities/JORFSearchResponse";
const Schema = _Schema;

const PeopleSchema = new Schema<IPeople, PeopleModel>(
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

PeopleSchema.static(
  "firstOrCreate",
  async function (tgPeople: {
    nom: string;
    prenom: string;
    lastKnownPosition: JORFSearchItem;
  }) {
    let people = await this.findOne({
      nom: {'$regex': `^${tgPeople.nom}$`, $options: 'i'}, // regex makes the search case-insensitive
      prenom: {'$regex': `^${tgPeople.prenom}$`, $options: 'i'},
    })
    if (people && !people.lastKnownPosition) {
      people.lastKnownPosition = tgPeople.lastKnownPosition;
      people = await people.save();
    } else if (!people) {
      people = await new this({
        nom: tgPeople.nom,
        prenom: tgPeople.prenom,
        lastKnownPosition: tgPeople.lastKnownPosition,
      }).save();
    }

    return people;
  },
);

export default model<IPeople, PeopleModel>("People", PeopleSchema);
