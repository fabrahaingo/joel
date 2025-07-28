import { SourceName, TypeOrdre, WikidataId } from "../types.ts";

export type JORFSearchResponse = null | string | JORFSearchRawItem[];

interface OrganisationRaw {
  nom?: string;
  wikidata_id?: WikidataId;
}

interface Organisation extends OrganisationRaw {
  nom: string;
  wikidata_id?: WikidataId;
  organisation_militaire?: WikidataId;
  ecole?: WikidataId;
  etablissement_enseignement_superieur?: WikidataId;
  cour_appel?: WikidataId;
  autorite_administrative_independante?: WikidataId;
  academie?: WikidataId;
  tribunal?: WikidataId;
  tribunal_grande_instance?: WikidataId;
  tribunal_instance?: WikidataId;
}

// Minimal expected record from JORFSearch
interface JORFSearchRawItem {
  source_date?: string;
  source_id?: string;
  source_name?: string;
  type_ordre?: string;
  nom?: string;
  prenom?: string;
  organisations?: OrganisationRaw[];
  remplacement?: {
    sexe?: "F" | "M";
    nom?: string;
    prenom?: string;
  };
}

// Record after parsing and data cleaning
export interface JORFSearchItem extends JORFSearchRawItem {
  organisations: Organisation[];
  remplacement?: {
    sexe?: "F" | "M";
    nom: string;
    prenom: string;
    nom_alternatif?: string;
    autres_prenoms?: string;
  };
  source_date: string;
  source_id: string;
  source_name: SourceName;
  type_ordre: TypeOrdre;

  sexe?: "F" | "M";
  nom: string;
  prenom: string;
  date_naissance?: string;
  lieu_naissance?: string;
  nom_alternatif?: string;
  autres_prenoms?: string;

  ambassadeur_pays?: string;
  annees_bonification?: string;
  annees_service?: string;
  armee?: string;
  armee_grade?: string;
  armee_grade_precedent?: string;
  autorisation_exercice_medecin?: string;
  autorite_delegation?: string;
  cabinet?: string;
  centre_detention?: string;
  commissaire_de_justice_residence?: string;
  commissaire_de_justice_residence_departement_code?: number;
  commission_parlementaire?: string;
  conge_parental?: string;
  consul?: string;
  corps?: string;
  cour_administrative_appel?: string;
  cour_appel?: string;
  date_debut?: string;
  date_fin?: string;
  delegation_parlementaire?: string;
  depart_retraite?: string;
  duree?: string;
  ecole?: string;
  eleve_ena?: string;
  eleve_ens?: string;
  eleve_ira?: string;
  grade?: string;
  grade_precedent?: string;
  grade_precedent_date?: string;
  greffier_residence?: string;
  greffier_residence_departement_code?: number;
  huissier_residence?: string;
  huissier_residence_departement_code?: number;
  inspecteur_general?: string;
  magistrat?: string;
  medaille_agrafe?: string;
  medaille_militaire?: string;
  medaille_securite_interieure?: string;
  ministre?: string;
  nigend?: string;
  nigendmedaille_securite_interieure?: string;
  nomme_par?: string;
  notaire_residence?: string;
  notaire_residence_departement_code?: number;
  numero_livret_de_solde?: string;
  ordre_nation?: boolean;
  parlement?: string;
  prefet_departement?: string;
  prefet_departement_code?: number;
  prefet_region?: string;
  professeur?: string;
  professeur_discipline?: string;
  professeur_section?: string;
  recteur_academie?: string;
  recteur_region_academique?: string;
  secretaire_affaires_etrangeres?: string;
  secretaire_etat?: string;
  "sous-prefecture_departement_code"?: number;
  "sous-prefet_sous-prefecture"?: string;
  tribunal?: string;
  tribunal_administratif?: string;
  tribunal_commerce?: string;
  tribunal_instance?: string;
  tribunal_judiciaire?: string;
  tribunal_pour_enfants?: string;
  tribunal_premiere_instance?: string;
  tribunal_proximite?: string;

  a_sa_demande?: boolean;
  ambassadeur?: boolean;
  ambassadeur_thematique?: boolean;
  avocat_aux_conseils?: boolean;
  cabinet_ministeriel?: boolean;
  citation?: boolean;
  commissaire_de_justice?: boolean;
  commissaire_de_justice_creation_office?: boolean;
  commissaire_gouvernement?: boolean;
  concours?: boolean;
  conseil_administration?: boolean;
  conseil_des_ministres?: boolean;
  conseiller_affaire_etrangeres?: boolean;
  cour_cassation?: boolean;
  cour_comptes?: boolean;
  directeur_academie?: boolean;
  direction_hopital?: boolean;
  eleve_mines?: boolean;
  eleve_polytechnique?: boolean;
  eleve_ponts_et_chaussees?: boolean;
  greffier?: boolean;
  haut_fonctionnaire_defense_securite?: boolean;
  huissier?: boolean;
  huissier_creation_office?: boolean;
  legion_honneur?: boolean;
  maitre_de_conference?: boolean;
  medaille_reconnaissance_terrorisme?: boolean;
  membre_gouvernement?: boolean;
  notaire?: boolean;
  notaire_creation_office?: boolean;
  notaire_suppression_office?: boolean;
  notaire_tranfert_office?: boolean;
  ordre_merite?: boolean;
  personnalite_qualifiee?: boolean;
  prefet?: boolean;
  president?: boolean;
  renouvellement?: boolean;
  secretaire_general_de_prefecture?: boolean;
  "sous-prefet"?: boolean;
  suppleant?: boolean;
  tribunal_grande_instance?: boolean;
  visa_emploi_superieur?: boolean;
  visa_grands_etablissements?: boolean;
}

export function cleanJORFItems(
  jorf_items_raw: JORFSearchRawItem[]
): JORFSearchItem[] {
  return jorf_items_raw.reduce((clean_items: JORFSearchItem[], item_raw) => {
    // drop records where any of the required fields is undefined
    if (
      item_raw.source_date === undefined ||
      item_raw.source_id === undefined ||
      item_raw.source_name === undefined ||
      item_raw.type_ordre === undefined ||
      item_raw.nom === undefined ||
      item_raw.prenom === undefined
    ) {
      return clean_items;
    }

    item_raw.organisations ??= [];

    // Drop organisations where the name is missing
    const clean_organisations = item_raw.organisations
      .filter((org_raw) => org_raw.nom !== undefined)
      .map((org) => ({
        ...org,
        wikidata_id: org.wikidata_id?.toUpperCase()
      })) as Organisation[];

    // Drop remplacement where the name is missing
    if (
      item_raw.remplacement?.nom === undefined ||
      item_raw.remplacement.prenom === undefined
    ) {
      item_raw.remplacement = undefined;
    }

    // Replace potential misspellings some type_ordre
    switch (item_raw.type_ordre) {
      case "admissibilite":
        item_raw.type_ordre = "admissibilité";
        break;
      case "conférés":
        item_raw.type_ordre = "conféré";
        break;
    }

    const clean_item: JORFSearchItem = {
      ...item_raw,
      organisations: clean_organisations
    } as JORFSearchItem;

    // extend FunctionTag eleve_ena to include INSP students
    if (
      clean_item.organisations.length > 0 &&
      clean_item.organisations[0]?.wikidata_id === "Q109039648" &&
      clean_item.type_ordre === "nomination" &&
      clean_item.date_debut !== undefined
    ) {
      const year = parseInt(clean_item.date_debut.slice(0, 4));
      if (year != -1) {
        clean_item.eleve_ena = `${String(year)}-${String(year + 2)}`;
      }
    }

    clean_items.push(clean_item);
    return clean_items;
  }, []);
}
