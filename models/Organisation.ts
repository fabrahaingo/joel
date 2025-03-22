import { Schema as _Schema, model } from "mongoose";
const Schema = _Schema;
import umami from "../utils/umami";
import { IOrganisation, OrganisationModel } from "../types";

const OrganisationSchema = new Schema<IOrganisation, OrganisationModel>(
  {
    nom: {
      type: String,
      required: true,
    },
    wikidata_id: {
      type: String,
      required: true,
      default: "fr",
    },
  },
  {
    timestamps: true,
  },
);

OrganisationSchema.static(
  "firstOrCreate",
  async function (args: { nom: string; wikidata_id: string }) {
    const organization: IOrganisation | null = await this.findOne({
      wikidata_id: args.wikidata_id,
    });

    if (organization === null) {
      await umami.log({ event: "/new-organisation" });
      const newOrganization: IOrganisation = new this({
        nom: args.nom,
        wikidata_id: args.wikidata_id,
      });
      await newOrganization.save();
      return newOrganization;
    } else if (!(args.nom === organization.nom)) {
      // Update the organisation name if it has changed
      organization.nom = args.nom;
      await organization.save();
    }

    return organization;
  },
);

export default model<IOrganisation, OrganisationModel>(
  "Organisation",
  OrganisationSchema,
);
