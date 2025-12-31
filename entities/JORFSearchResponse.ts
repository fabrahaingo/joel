import { trimStrings } from "../utils/text.utils.ts";
import {
  SOURCE_NAME_VALUES,
  SourceName,
  TYPE_ORDRE_VALUES,
  TypeOrdre,
  WikidataId
} from "../types.ts";

export type JORFSearchResponse = null | string | JORFSearchRawItem[];

interface JORFSearchOrganisationRaw {
  nom?: string;
  wikidata_id?: WikidataId;
}

interface JORFSearchOrganisation extends JORFSearchOrganisationRaw {
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
  organisations?: JORFSearchOrganisationRaw[];
  remplacement?: {
    sexe?: "F" | "M";
    nom?: string;
    prenom?: string;
  };

  ambassadeur?: boolean;
  ambassadeur_pays?: string;
  ambassadeur_thematique?: boolean;
  cabinet?: string;
  cabinet_ministeriel?: boolean;
}

// Record after parsing and data cleaning
export interface JORFSearchItem extends JORFSearchRawItem {
  organisations: JORFSearchOrganisation[];
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

export interface JORFSearchItemCleaningStats {
  raw_item_nb: number;
  clean_item_nb: number;
  dropped_item_nb: number;

  missing_source_date: number;
  missing_source_id: number;
  missing_source_name: number;
  missing_type_ordre: number;
  missing_nom: number;
  missing_prenom: number;
}

export function cleanJORFItems(jorf_items_raw: JORFSearchRawItem[]): {
  cleanItems: JORFSearchItem[];
  processingStats: JORFSearchItemCleaningStats;
} {
  let missing_source_date = 0;
  let missing_source_id = 0;
  let missing_source_name = 0;
  let missing_type_ordre = 0;
  let missing_nom = 0;
  let missing_prenom = 0;

  const jorf_items_clean: JORFSearchItem[] = jorf_items_raw.reduce(
    (clean_items: JORFSearchItem[], item_raw_tab) => {
      const item_raw = { ...item_raw_tab };

      // drop records where any of the required fields is undefined
      if (item_raw.source_date === undefined) {
        missing_source_date += 1;
        return clean_items;
      }

      if (item_raw.source_id === undefined) {
        missing_source_id += 1;
        return clean_items;
      }

      if (item_raw.source_name === undefined) {
        missing_source_name += 1;
        return clean_items;
      }
      if (!SOURCE_NAME_VALUES.some((m) => m === item_raw.source_name)) {
        console.log(
          `Unexpected JORFSearch source_name ${item_raw.source_name}. Processing anyway.`
        );
      }
      const source_name_clean = item_raw.source_name as SourceName;

      if (item_raw.type_ordre === undefined) {
        missing_type_ordre += 1;
        return clean_items;
      }

      // Replace potential misspellings of some type_ordre
      switch (item_raw.type_ordre) {
        case "admissibilite":
          item_raw.type_ordre = "admissibilité";
          break;
        case "conférés":
          item_raw.type_ordre = "conféré";
          break;
      }
      if (!TYPE_ORDRE_VALUES.some((m) => m === item_raw.type_ordre)) {
        console.log(
          `Unexpected JORFSearch type_ordre ${item_raw.type_ordre}. Processing anyway.`
        );
      }
      const type_ordre_clean = item_raw.type_ordre as TypeOrdre;

      if (item_raw.nom === undefined) {
        missing_nom += 1;
        return clean_items;
      }

      if (item_raw.prenom === undefined) {
        missing_prenom += 1;
        return clean_items;
      }

      item_raw.organisations ??= [];

      // Drop organisations where the name is missing
      const clean_organisations = item_raw.organisations.reduce(
        (tab: JORFSearchOrganisation[], org_raw) => {
          if (org_raw.nom === undefined) return tab;
          const org: JORFSearchOrganisation = {
            ...trimStrings(org_raw),
            nom: org_raw.nom.trim(),
            wikidata_id: org_raw.wikidata_id?.toUpperCase()
          };
          tab.push(org);
          return tab;
        },
        []
      );

      let remplacement: { prenom: string; nom: string } | undefined = undefined;
      // Drop remplacement where the name is missing
      if (
        item_raw.remplacement?.nom != null &&
        item_raw.remplacement.prenom != null
      ) {
        remplacement = {
          prenom: item_raw.remplacement.prenom,
          nom: item_raw.remplacement.nom
        };
      }

      if (item_raw.cabinet != undefined) {
        item_raw.cabinet_ministeriel = true;
      }

      if (
        item_raw.ambassadeur_pays != undefined ||
        item_raw.ambassadeur_thematique != undefined
      ) {
        item_raw.ambassadeur = true;
      }

      const clean_item: JORFSearchItem = {
        ...trimStrings(item_raw),
        prenom: item_raw.prenom.trim(),
        nom: item_raw.nom.trim(),
        type_ordre: type_ordre_clean,
        source_date: item_raw.source_date,
        source_name: source_name_clean,
        source_id: item_raw.source_id,
        remplacement: remplacement,
        organisations: clean_organisations
      };

      // extend FunctionTag eleve_ena to include INSP students
      if (
        clean_item.organisations.length > 0 &&
        clean_item.organisations[0]?.wikidata_id === "Q109039648" &&
        clean_item.type_ordre === "nomination" &&
        clean_item.date_debut !== undefined &&
        clean_item.date_fin === undefined &&
        !clean_item.corps?.toLowerCase().includes("grade")
      ) {
        const year = parseInt(clean_item.date_debut.slice(0, 4));
        if (year != -1) {
          clean_item.eleve_ena = `${String(year)}-${String(year + 2)}`;
        }
      }

      clean_items.push(clean_item);
      return clean_items;
    },
    []
  );

  const raw_item_nb = jorf_items_raw.length;
  const clean_item_nb = jorf_items_clean.length;

  return {
    cleanItems: jorf_items_clean,
    processingStats: {
      raw_item_nb,
      clean_item_nb,
      dropped_item_nb: raw_item_nb - clean_item_nb,
      missing_source_date,
      missing_source_id,
      missing_source_name,
      missing_type_ordre,
      missing_nom,
      missing_prenom
    }
  };
}

export function mergeJORFSearchItemCleaningStats(
  statsList: JORFSearchItemCleaningStats[]
): JORFSearchItemCleaningStats {
  const merged = statsList.reduce(
    (acc, s) => {
      acc.raw_item_nb += s.raw_item_nb;
      acc.clean_item_nb += s.clean_item_nb;

      // keep summing all missing counters
      acc.missing_source_date += s.missing_source_date;
      acc.missing_source_id += s.missing_source_id;
      acc.missing_source_name += s.missing_source_name;
      acc.missing_type_ordre += s.missing_type_ordre;
      acc.missing_nom += s.missing_nom;
      acc.missing_prenom += s.missing_prenom;

      return acc;
    },
    {
      raw_item_nb: 0,
      clean_item_nb: 0,
      dropped_item_nb: 0, // recomputed after reduce
      missing_source_date: 0,
      missing_source_id: 0,
      missing_source_name: 0,
      missing_type_ordre: 0,
      missing_nom: 0,
      missing_prenom: 0
    } satisfies JORFSearchItemCleaningStats
  );

  merged.dropped_item_nb = merged.raw_item_nb - merged.clean_item_nb;

  return merged;
}
