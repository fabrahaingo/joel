import { Schema as _Schema, model } from "mongoose";
import { JORFSearchPublication } from "../entities/JORFSearchResponseMeta.ts";

const Schema = _Schema;

const TagsSchema = new Schema<JORFSearchPublication["tags"]>(
  {
    autres: Boolean,
    mesure_nominative: Boolean,
    warning: Boolean,
    concours_ou_examen: Boolean,
    vacance_de_poste: Boolean,
    diffusion_hertzienne: Boolean,
    convention_collective: Boolean,
    resultats_jeux: Boolean,
    portant_creation: Boolean,
    fixant_nombre_de_postes: Boolean,
    remboursement_securite_sociale: Boolean,
    societe_civile_professionnelle: Boolean,
    remunerations_agents_etat: Boolean,
    conseil_constitutionnel: Boolean,
    senat: Boolean,
    changement_de_nom: Boolean,
    office_de_huissier_notaire: Boolean,
    assemblee_nationale: Boolean,
    traitement_de_donnees: Boolean,
    appellation_d_origine: Boolean,
    tarification_securite_sociale: Boolean,
    cours_banque_de_france: Boolean,
    commission_mixte_paritaire: Boolean,
    catastrophe_naturelle: Boolean,
    statistique_mensuelle: Boolean,
    station_de_tourisme: Boolean,
    agrement_national: Boolean,

    cabinet_ministeriel: String,
    utilite_publique: String,
    insaisissabilite_bien_culturel: String,
    zone_geographique: String,
    gel_de_fonds_ou_avoirs: String,
    substances_chimiques: String,
    permis_de_recherches: String,
    vocabulaire: String
  },
  { _id: false }
);

const PublicationSchema = new Schema<JORFSearchPublication>(
  {
    id: {
      type: String,
      required: true
    },
    date: {
      type: String,
      required: true
    },
    date_obj: {
      type: Date,
      required: true
    },
    title: {
      type: String,
      required: true
    },
    nor: String,
    ministere: String,
    autorite: String,
    tags: {
      type: TagsSchema,
      required: true,
      default: () => ({})
    }
  },
  { timestamps: true }
);

PublicationSchema.index({ id: 1 });
PublicationSchema.index({ title: 1 });
PublicationSchema.index({ date_obj: 1 });

export const Publication = model<JORFSearchPublication>(
  "Publication",
  PublicationSchema
);
