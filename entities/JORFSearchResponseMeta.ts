import { JORFtoDate } from "../utils/date.utils.ts";

export type JORFSearchResponseMeta = null | string | JORFSearchPublicationRaw[];

// Minimal expected publication from JORFSearch
interface JORFSearchPublicationRaw {
  id?: string;
  date?: string;
  title?: string;
  tags?: object;
}

export interface JORFSearchPublication extends JORFSearchPublicationRaw {
  id: string;
  date: string;
  date_obj: Date;
  title: string;
  nor?: string;
  ministere?: string;
  autorite?: string;
  tags: {
    autres?: boolean;
    mesure_nominative?: boolean;
    warning?: boolean;
    concours_ou_examen?: boolean;
    vacance_de_poste?: boolean;
    diffusion_hertzienne?: boolean;
    convention_collective?: boolean;
    resultats_jeux?: boolean;
    portant_creation?: boolean;
    fixant_nombre_de_postes?: boolean;
    remboursement_securite_sociale?: boolean;
    societe_civile_professionnelle?: boolean;
    remunerations_agents_etat?: boolean;
    conseil_constitutionnel?: boolean;
    senat?: boolean;
    changement_de_nom?: boolean;
    office_de_huissier_notaire?: boolean;
    assemblee_nationale?: boolean;
    traitement_de_donnees?: boolean;
    appellation_d_origine?: boolean;
    tarification_securite_sociale?: boolean;
    cours_banque_de_france?: boolean;
    commission_mixte_paritaire?: boolean;
    catastrophe_naturelle?: boolean;
    statistique_mensuelle?: boolean;
    station_de_tourisme?: boolean;
    agrement_national?: boolean;

    cabinet_ministeriel?: string;
    utilite_publique?: string;
    insaisissabilite_bien_culturel?: string;
    zone_geographique?: string;
    gel_de_fonds_ou_avoirs?: string;
    substances_chimiques?: string;
    permis_de_recherches?: string;
    vocabulaire?: string;
  };
}

export function cleanJORFPublication(
  jorf_publication_raw: JORFSearchPublicationRaw[]
): JORFSearchPublication[] {
  return jorf_publication_raw.reduce(
    (clean_publications: JORFSearchPublication[], publication_raw) => {
      // drop records where any of the required fields is undefined
      if (
        publication_raw.id === undefined ||
        publication_raw.date === undefined ||
        publication_raw.title === undefined
      ) {
        return clean_publications;
      }

      clean_publications.push({
        ...publication_raw,
        id: publication_raw.id,
        date: publication_raw.date,
        title: publication_raw.title,
        tags: publication_raw.tags ?? {},
        date_obj: JORFtoDate(publication_raw.date)
      });
      return clean_publications;
    },
    []
  );
}
