export type JORFSearchResponseMeta = null | string | JORFSearchPublicationRaw[];

// Minimal expected publication from JORFSearch
interface JORFSearchPublicationRaw {
  id?: string;
  date?: string;
  title?: string;
  tags?: {};
}

export interface JORFSearchPublication extends JORFSearchPublicationRaw {
  id: string;
  date: string;
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
    diffusion_hertzienne?: string;
    convention_collective?: string;
    resultats_jeux?: string;
    portant_creation?: string;
    fixant_nombre_de_postes?: string;
    remboursement_securite_sociale?: string;
    societe_civile_professionnelle?: string;
    cabinet_ministeriel?: string;
    remunerations_agents_etat?: string;
    conseil_constitutionnel?: string;
    senat?: string;
    changement_de_nom?: boolean;
    office_de_huissier_notaire?: string;
    assemblee_nationale?: string;
    utilite_publique?: string;
    trapublicationent_de_donnees?: string;
    appellation_d_origine?: string;
    insaisissabilite_bien_culturel?: string;
    tarification_securite_sociale?: string;
    zone_geographique?: string;
    gel_de_fonds_ou_avoirs?: string;
    cours_banque_de_france?: string;
    commission_mixte_paritaire?: string;
    substances_chimiques?: string;
    catastrophe_naturelle?: string;
    statistique_mensuelle?: string;
    station_de_tourisme?: string;
    permis_de_recherches?: string;
    agrement_national?: string;
    vocabulaire?: string;
  };
}

export function cleanJORFPublication(
  jorf_publication_raw: JORFSearchPublicationRaw[],
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
      // Drop remplacement if name is missing
      if (publication_raw.tags === undefined) {
        publication_raw.tags = {};
      }

      clean_publications.push(publication_raw as JORFSearchPublication);
      return clean_publications;
    },
    [],
  );
}
