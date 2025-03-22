export type JORFSearchResponse = {
  [key: string]: string | undefined | { nom: string }[];

  organisations: {
    nom: string;
  }[];
  source_date: string;
  source_id: string;
  source_name: string;
  type_ordre: string;
  sexe: string;
  nom: string;
  prenom: string;

  suppleant?: string;
  parlement?: string;
  date_debut?: string;
  cabinet?: string;
  cabinet_ministeriel?: string;
  grade?: string;
  conseil_administration?: string;
  commissaire_gouvernement?: string;
  remplacement?: string;
  ecole?: string;
  magistrat?: string;
  tribunal?: string;
  tribunal_premiere_instance?: string;
  nom_alternatif?: string;
  duree?: string;
  tribunal_judiciaire?: string;
  date_fin?: string;
  a_sa_demande?: string;
  depart_retraite?: string;
  autorisation_exercice_medecin?: string;
  date_naissance?: string;
  lieu_naissance?: string;
  autres_prenoms?: string;
  inspecteur_general?: string;
  autorite_delegation?: string;
  commission_parlementaire?: string;
  cour_appel?: string;
  professeur?: string;
  professeur_discipline?: string;
  ordre_merite?: string;
  annees_service?: string;
  armee_grade?: string;
  personnalite_qualifiee?: string;
  corps?: string;
  secretaire_affaires_etrangeres?: string;
  notaire?: string;
  notaire_residence?: string;
  notaire_residence_departement_code?: string;
  notaire_suppression_office?: string;
  commissaire_de_justice?: string;
  commissaire_de_justice_residence?: string;
  commissaire_de_justice_residence_departement_code?: string;
  greffier?: string;
  greffier_residence?: string;
  greffier_residence_departement_code?: string;
  tribunal_commerce?: string;
  conseil_des_ministres?: string;
  president?: string;
  "sous-prefet"?: string;
  "sous-prefet_sous-prefecture"?: string;
  "sous-prefecture_departement_code"?: string;
  secretaire_general_de_prefecture?: string;
  visa_emploi_superieur?: string;
  prefet?: string;
  delegation_parlementaire?: string;
  tribunal_pour_enfants?: string;
  conge_parental?: string;
  cour_comptes?: string;
  direction_hopital?: string;
  membre_gouvernement?: string;
  secretaire_etat?: string;
  ministre?: string;
  tribunal_administratif?: string;
  ambassadeur?: string;
  ambassadeur_pays?: string;
  cour_cassation?: string;
  directeur_academie?: string;
  renouvellement?: string;
  avocat_aux_conseils?: string;
  tribunal_proximite?: string;
  consul?: string;
  cour_administrative_appel?: string;
  prefet_region?: string;
  prefet_departement?: string;
  prefet_departement_code?: string;
  professeur_section?: string;
  legion_honneur?: string;
  nomme_par?: string;
  grade_precedent?: string;
  grade_precedent_date?: string;
  citation?: string;
  armee?: string;
  armee_grade_precedent?: string;
  eleve_ens?: string;
  eleve_ena?: string;
  eleve_ira?: string;
  eleve_mines?: string;
  eleve_ponts_et_chaussees?: string;
  visa_grands_etablissements?: string;
  medaille_militaire?: string;
  conseiller_affaire_etrangeres?: string;
  concours?: string;
  annees_bonification?: string;
  haut_fonctionnaire_defense_securite?: string;
  recteur_academie?: string;
  ambassadeur_thematique?: string;
  notaire_creation_office?: string;
  recteur_region_academique?: string;
  commissaire_de_justice_creation_office?: string;
  ordre_nation?: string;
  medaille_reconnaissance_terrorisme?: string;
  eleve_polytechnique?: string;
  huissier?: string;
  huissier_residence?: string;
  huissier_residence_departement_code?: string;
  maitre_de_conference?: string;
  medaille_securite_interieure?: string;
  nigendmedaille_securite_interieure?: string;
  nigend?: string;
  numero_livret_de_solde?: string;
  huissier_creation_office?: string;
  medaille_agrafe?: string;
  tribunal_instance?: string;
  tribunal_grande_instance?: string;
  centre_detention?: string;
  notaire_tranfert_office?: string;
};

export function cleanJORFItems(
    jorf_items: {
      source_date?: string,
      source_id?: string,
      source_name?: string,
      type_ordre?: string,
      nom?: string,
      prenom?: string,
      remplacement?: { nom?: string, prenom?: string },
    }[]) {
  return jorf_items
      // remove record where any of the required fields is undefined
      .filter(elem=> (
          elem.source_date !== undefined &&
          elem.source_id !== undefined &&
          elem.source_name !== undefined &&
          elem.type_ordre !== undefined &&
          elem.nom !== undefined &&
          elem.prenom !== undefined
      ))
      // correct type_ordre when wrong spelling is used
      .map(elem=> {
        if (elem.type_ordre === "admissibilite") {
          return { ...elem, type_ordre: "admissibilité"}
        }
        return elem
      })
      // Drop remplacement field from records where the associated prenom or nom is missing
      .map(elem=> {
        if (elem?.remplacement?.nom === undefined || elem?.remplacement?.prenom === undefined) {
          return { ...elem, remplacement: undefined}
        }
        return elem
        });
}
