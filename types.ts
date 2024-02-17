import { Model, Types } from "mongoose";
import TelegramBot from "node-telegram-bot-api";

export type CommandType = {
  regex: RegExp;
  action: (bot: TelegramBot) => (msg: TelegramBot.Message) => {
    default: void;
  };
}[];

export type IUser = {
  _id: number;
  chatId: number;
  language_code: string;
  status: string;
  followedPeople: Array<{
    peopleId: Types.ObjectId;
    lastUpdate: Date;
  }>;
  followedFunctions: Array<string>;
  save: () => Promise<IUser>;
};

export interface UserModel extends Model<IUser> {
  firstOrCreate: (args: {
    tgUser: TelegramBot.User | undefined;
    chatId: number;
  }) => Promise<IUser>;
}

export type IBlocked = {
  chatId: string;
};

export type IPeople = {
  _id: Types.ObjectId;
  nom: string;
  prenom: string;
  lastKnownPosition: Object;
  save: () => Promise<IPeople>;
};

export interface PeopleModel extends Model<IPeople> {
  firstOrCreate: (people: any) => Promise<IPeople>;
}

export enum FunctionTags {
  "Ambassadeur" = "ambassadeur",
  "Ambassadeur pays" = "ambassadeur_pays",
  "Ambassadeur thématique" = "ambassadeur_thematique",
  "Avocat aux conseils" = "avocat_aux_conseils",
  "Cabinet" = "cabinet",
  "Cabinet ministeriel" = "cabinet_ministeriel",
  "Centre de détention" = "centre_detention",
  "Commissaire de justice" = "commissaire_de_justice",
  "Commissaire de justice création d'office" = "commissaire_de_justice_creation_office",
  "Commissaire de justice résidence" = "commissaire_de_justice_residence",
  "Commissaire de justice résidence département code" = "commissaire_de_justice_residence_departement_code",
  "Commissaire gouvernement" = "commissaire_gouvernement",
  "Commission parlementaire" = "commission_parlementaire",
  "Conseil des ministres" = "conseil_des_ministres",
  "Conseiller affaire étrangères" = "conseiller_affaire_etrangeres",
  "Consul" = "consul",
  "Cour administrative d'appel" = "cour_administrative_appel",
  "Cour d'appel" = "cour_appel",
  "Cour de cassation" = "cour_cassation",
  "Cour des comptes" = "cour_comptes",
  "Délégation parlementaire" = "delegation_parlementaire",
  "Directeur academie" = "directeur_academie",
  "Direction hopital" = "direction_hopital",
  "Élève ENA" = "eleve_ena",
  "Élève ENS" = "eleve_ens",
  "Élève IRA" = "eleve_ira",
  "Élève Mines" = "eleve_mines",
  "Élève polytechnique" = "eleve_polytechnique",
  "Élève Ponts et chaussées" = "eleve_ponts_et_chaussees",
  "Grade" = "grade",
  "Greffier" = "greffier",
  "Greffier résidence" = "greffier_residence",
  "Greffier résidence département code" = "greffier_residence_departement_code",
  "Haut fonctionnaire défense sécurité" = "haut_fonctionnaire_defense",
  "Huissier" = "huissier",
  "Huissier création office" = "huissier_creation_office",
  "Huissier résidence" = "huissier_residence",
  "Huissier résidence département code" = "huissier_residence_departement_code",
  "Légion d'honneur" = "legion_honneur",
  "Magistrat" = "magistrat",
  "Maitre de conférence" = "maitre_de_conference",
  "Médaille agrafe" = "medaille_agrafe",
  "Medaille militaire" = "medaille_militaire",
  "Medaille securité intérieure" = "medaille_securite_interieure",
  "Membre gouvernement" = "membre_gouvernement",
  "Ministre" = "ministre",
  "Notaire" = "notaire",
  "Notaire création d'office" = "notaire_creation_office",
  "Notaire résidence" = "notaire_residence",
  "Notaire résidence département code" = "notaire_residence_departement_code",
  "Notaire suppression d'office" = "notaire_suppression_office",
  "Notaire tranfert d'office" = "notaire_tranfert_office",
  "Ordre du mérite" = "ordre_merite",
  "Ordre de la nation" = "ordre_nation",
  "Préfet" = "prefet",
  "Préfet de département" = "prefet_departement",
  "Préfet de département code" = "prefet_departement_code",
  "Préfet de région" = "prefet_region",
  "Président" = "president",
  "Professeur" = "professeur",
  "Professeur discipline" = "professeur_discipline",
  "Professeur section" = "professeur_section",
  "Recteur académie" = "recteur_academie",
  "Recteur région académique" = "recteur_region_academique",
  "Secrétaire affaires étrangères" = "secretaire_affaires_etrangeres",
  "Secrétaire d'état" = "secretaire_etat",
  "Secrétaire général de préfecture" = "secretaire_general_de_prefecture",
  "Sous-préfecture de département code" = "sous-prefecture_departement_code",
  "Sous-préfet" = "sous-prefet",
  "Sous-préfet sous-préfecture" = "sous-prefet_sous-prefecture",
  "Tribunal" = "tribunal",
  "Tribunal administratif" = "tribunal_administratif",
  "Tribunal de commerce" = "tribunal_commerce",
  "Tribunal de grande instance" = "tribunal_grande_instance",
  "Tribunal d'instance" = "tribunal_instance",
  "Tribunal judiciaire" = "tribunal_judiciaire",
  "Tribunal pour enfants" = "tribunal_pour_enfants",
  "Tribunal de première instance" = "tribunal_premiere_instance",
  "Tribunal de proximité" = "tribunal_proximite",
  "Visa grands établissements" = "visa_grands_etablissements",
}

export enum PromoENA {
  "guillaume apollinaire" = "2022-2023",
  "germaine tillion" = "2021-2022",
  "aime cesaire" = "2020-2021",
  "hannah arendt" = "2019-2020",
  "moliere" = "2018-2019",
  "georges clemenceau" = "2017-2018",
  "louise weiss" = "2016-2017",
  "georges orwell" = "2015-2016",
  "winston churchill" = "2014-2015",
  "jean de la fontaine" = "2013-2014",
  "jean zay" = "2012-2013",
  "marie curie" = "2011-2012",
  "jean-jacques rousseau" = "2010-2011",
  "robert badinter" = "2009-2011",
  "emile zola" = "2008-2010",
  "willy brandt" = "2007-2009",
  "aristide briand" = "2006-2008",
  "republique" = "2005-2007",
  "simone veil" = "2004-2006",
  "romain gary" = "2003-2005",
  "leopold sedar senghor" = "2002-2004",
  "rene cassin" = "2001-2003",
  "copernic" = "2000-2002",
  "nelson mandela" = "1999-2001",
  "averroes" = "1998-2000",
  "cyrano de bergerac" = "1997-1999",
  "valmy" = "1996-1998",
  "marc bloch" = "1995-1997",
  "victor schoelcher" = "1994-1996",
  "rene char" = "1993-1995",
  "antoine de saint-exupery" = "1992-1994",
  "leon gambetta" = "1991-1993",
  "condorcet" = "1990-1992",
  "victor hugo" = "1989-1991",
  "jean monnet" = "1988-1990",
  "liberte egalite fraternite" = "1987-1989",
  "michel de montaigne" = "1986-1988",
  "fernand braudel" = "1985-1987",
  "denis diderot" = "1984-1986",
  "leonard de vinci" = "1983-1985",
  "louise michel" = "1982-1984",
  "solidarite" = "1981-1983",
  "henri-francois d'aguesseau" = "1980-1982",
}

export enum PromoINSP {
  "2024 " = "2023-2024",
}
