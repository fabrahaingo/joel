import {IPeople, SourceName, TypeOrdre, WikiDataId} from "../types";
import People from "../models/People";

export type JORFSearchResponse = null | string | JORFSearchRawItem[];

interface OrganisationRaw{
  nom?: string;
  wikidata_id?: WikiDataId;
  organisation_militaire?: WikiDataId;
  ecole?: WikiDataId;
  etablissement_enseignement_superieur?: WikiDataId;
  cour_appel?: WikiDataId;
  autorite_administrative_independante?: WikiDataId;
  academie?: WikiDataId;
  tribunal?: WikiDataId;
  tribunal_grande_instance?: WikiDataId;
  tribunal_instance?: WikiDataId;
}

interface Organisation extends OrganisationRaw{
  nom: string;
}

// Minimal expected record from JORFSearch
interface JORFSearchRawItem {
  source_date?: string;
  source_id?: string;
  source_name?: string;
  type_ordre?: string;
  nom?: string;
  prenom?: string;
  organisations: OrganisationRaw[];
  remplacement?: {
    sexe?: "F" | "M";
    nom?: string;
    prenom?: string;
    nom_alternatif?: string;
    autres_prenoms?: string;
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

export async function cleanJORFItems(jorf_items_raw: JORFSearchRawItem[]): Promise<JORFSearchItem[]> {
  const cleanItems = jorf_items_raw.reduce(
      (clean_items: JORFSearchItem[], item_raw) => {

        // drop records where any of the required fields is undefined
        if (item_raw.source_date === undefined ||
            item_raw.source_id === undefined ||
            item_raw.source_name === undefined ||
            item_raw.type_ordre === undefined ||
            item_raw.nom === undefined ||
            item_raw.prenom === undefined) {
          return clean_items;
        }
        // Drop organisations if name is missing
        const clean_organisations = item_raw.organisations.filter(
            org_raw => org_raw.nom !== undefined
        ) as Organisation[];

        // Drop remplacement if name is missing
        if (item_raw?.remplacement?.nom === undefined || item_raw?.remplacement?.prenom === undefined) {
          item_raw.remplacement = undefined;
        }

        // Replace potential mispelling some type_ordre
        switch (item_raw?.type_ordre) {
          case "admissibilite":
            item_raw.type_ordre = "admissibilité";
            break
          case "conférés":
            item_raw.type_ordre = "conféré";
            break
        }

        clean_items.push({...item_raw, organisations: clean_organisations} as JORFSearchItem);
        return clean_items;
      },
      []);

  // We enrich the DB with the sexe from people in the JORFResponse
  const peopleWithSexeUnique = cleanItems.reduce(
      (list: { nom: string, prenom: string, sexe: "M" | "F" }[], i) => {
        if (i.sexe === undefined || list.find(j => j.nom === i.nom && j.prenom === i.prenom)) return list
        list.push({nom: i.nom, prenom: i.prenom, sexe: i.sexe})
        return list;
      }, []);

  const peopleFromDbWithoutSexe: IPeople[] = await People.find({
    nom: {$in: peopleWithSexeUnique.map(i => i.nom)},
    prenom: {$in: peopleWithSexeUnique.map(i => i.prenom)},
    sexe: {$exists: false}
  });

  for (const peopleDB of peopleFromDbWithoutSexe){
    const peopleWithSexe = peopleWithSexeUnique
        .find(i=>i.nom===peopleDB.nom && i.prenom === peopleDB.prenom);
    if (peopleWithSexe===undefined || peopleWithSexe.sexe===undefined) continue; // that should never happen
    peopleDB.sexe =peopleWithSexe.sexe;
    await peopleDB.save();
  }

  // We enrich the people in the JORFResponse with the sexe from the people in the DB
  const peopleFromResponseWithoutSexe = cleanItems.reduce(
      (list: { nom: string, prenom: string}[], i) => {
        if (i.sexe !== undefined || list.find(j => j.nom === i.nom && j.prenom === i.prenom)) return list
        list.push({nom: i.nom, prenom: i.prenom})
        return list;
      }, []);

  const peopleFromDbWithSexe: IPeople[] = await People.find({
    nom: {$in: peopleFromResponseWithoutSexe.map(i => i.nom)},
    prenom: {$in: peopleFromResponseWithoutSexe.map(i => i.prenom)},
    sexe: {$exists: true}
  });

  return cleanItems.map(i=> {
    if (i.sexe !== undefined) return i
    const peopleDB=peopleFromDbWithSexe.find(j => j.nom === i.nom && j.prenom === i.prenom);
    if (peopleDB === undefined || peopleDB.sexe === undefined) return i // that should never happen
    return {...i , sexe: peopleDB.sexe}
  });
}