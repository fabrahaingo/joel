import { Schema as _Schema, model } from "mongoose";
const Schema = _Schema;
import umami from "../utils/umami.ts";
import { IOrganisation, OrganisationModel, WikidataId } from "../types.ts";

const OrganisationSchema = new Schema<IOrganisation, OrganisationModel>(
  {
    nom: {
      type: String,
      required: true
    },
    wikidataId: {
      type: String,
      required: true,
      unique: true
    }
  },
  {
    timestamps: true
  }
);

OrganisationSchema.static(
  "findOrCreate",
  async function (
    args: { nom: string; wikidataId: WikidataId },
    lean = true
  ): Promise<IOrganisation> {
    const query = this.findOne({
      wikidataId: args.wikidataId.toUpperCase()
    });
    if (lean) query.lean();

    let organisation: IOrganisation | null = await query.exec();

    if (organisation === null) {
      umami.log({ event: "/new-organisation" });
      organisation = await this.create({
        nom: args.nom,
        wikidataId: args.wikidataId.toUpperCase()
      });
    }

    return organisation;
  }
);

export default model<IOrganisation, OrganisationModel>(
  "Organisation",
  OrganisationSchema
);
