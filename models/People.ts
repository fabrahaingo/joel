import { Schema as _Schema, model } from "mongoose";
import { IPeople, PeopleModel } from "../types.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import umami from "../utils/umami.ts";
const Schema = _Schema;

export interface LegacyPeople_V1 {
  nom: string;
  prenom: string;
  lastKnownPosition: JORFSearchItem;
}

const PeopleSchema = new Schema<IPeople, PeopleModel>(
  {
    nom: {
      type: String,
      required: true
    },
    prenom: {
      type: String,
      required: true
    }
  },
  { timestamps: true }
);

PeopleSchema.static(
  "findOrCreate",
  async function (peopleInfo: { nom: string; prenom: string }, lean = true) {
    const query = this.findOne({
      nom: peopleInfo.nom,
      prenom: peopleInfo.prenom
    }).collation({ locale: "fr", strength: 2 });
    if (lean) query.lean();

    let people: IPeople | null = await query.exec();

    if (people == null) {
      await umami.log("/person-added");
      people = await this.create({
        nom: peopleInfo.nom,
        prenom: peopleInfo.prenom
      });
    }

    return people;
  }
);

PeopleSchema.index({ prenom: 1, nom: 1 });

export default model<IPeople, PeopleModel>("People", PeopleSchema);
