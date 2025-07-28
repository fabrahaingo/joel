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
  "firstOrCreate",
  async function (args: { nom: string; wikidataId: WikidataId }) {
    const organization: IOrganisation | null = await this.findOne({
      wikidataId: { $regex: new RegExp(`^${args.wikidataId}$`), $options: "i" }
    });

    if (organization === null) {
      await umami.log({ event: "/new-organisation" });
      const newOrganization: IOrganisation = new this({
        nom: args.nom,
        wikidataId: args.wikidataId.toUpperCase()
      });
      await newOrganization.save();
      return newOrganization;
    } else if (args.nom !== organization.nom) {
      // Update the organisation name if it has changed
      organization.nom = args.nom;
      await organization.save();
    }

    return organization;
  }
);

export default model<IOrganisation, OrganisationModel>(
  "Organisation",
  OrganisationSchema
);
