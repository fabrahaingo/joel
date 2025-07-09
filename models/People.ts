import { Schema as _Schema, model } from "mongoose";
import { IPeople, PeopleModel } from "../types.js";
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
  },
  { timestamps: true },
);

PeopleSchema.static(
  "firstOrCreate",
  async function (tgPeople: {
    nom: string;
    prenom: string;
  }) {
    let people: IPeople | null = await this.findOne({
      nom: tgPeople.nom,
      prenom: tgPeople.prenom,
    });
    people ??= await new this({
        nom: tgPeople.nom,
        prenom: tgPeople.prenom,
      }).save();

    return people;
  },
);

export default model<IPeople, PeopleModel>("People", PeopleSchema);
