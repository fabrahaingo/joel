import { Model, Types } from "mongoose";
import { FunctionTags } from "./entities/FunctionTags";
import umami from "./utils/umami";
import { ButtonElement } from "./utils/keyboards.ts";
import { FindCursor } from "mongodb";

export interface CommandType {
  regex: RegExp;
  action: (session: ISession, msg?: string) => Promise<void>;
}

export type MessageApp = "Telegram" | "WhatsApp";
//| "Matrix";

export interface ButtonElement {
  text: string;
  desc?: string;
}
export type KeyboardType = "Buttons" | "List";

export interface ISession {
  messageApp: MessageApp;
  chatId: number;
  language_code: string;
  user: IUser | null | undefined;
  isReply: boolean | undefined;
  mainMenuKeyboard: ButtonElement[][];

  loadUser: () => Promise<void>;
  createUser: () => Promise<void>;
  sendMessage: (
    msg: string,
    keyboard?: ButtonElement[][],
    menuType?: KeyboardType
  ) => Promise<void>;
  sendTypingAction: () => Promise<void>;
  log: typeof umami.log;
}

// fields are undefined for users created before implementation
export interface IUser {
  _id: Types.ObjectId;
  messageApp: MessageApp;
  chatId: number;
  language_code: string;
  status: "active" | "blocked";
  followedPeople: {
    peopleId: Types.ObjectId;
    lastUpdate: Date;
  }[];
  followedNames: string[];
  followedOrganisations: {
    wikidataId: WikidataId;
    lastUpdate: Date;
  }[];
  followedFunctions: {
    functionTag: FunctionTags;
    lastUpdate: Date;
  }[];
  followedMeta: {
    metaType: string;
    lastUpdate: Date;
  }[];

  lastInteractionDay?: Date;
  lastInteractionWeek?: Date;
  lastInteractionMonth?: Date;

  createdAt: Date;
  updatedAt: Date;

  schemaVersion: number;

  save: () => Promise<IUser>;
  validate: () => Promise<void>;
  toObject: () => IUser;

  updateInteractionMetrics: () => Promise<void>;

  checkFollowedPeople: (arg0: IPeople) => boolean;
  checkFollowedFunction: (arg0: FunctionTags) => boolean;
  checkFollowedName: (arg0: string) => boolean;
  addFollowedPeople: (arg0: IPeople) => Promise<boolean>;
  addFollowedPeopleBulk: (arg0: IPeople[]) => Promise<boolean>;
  addFollowedFunction: (arg0: FunctionTags) => Promise<boolean>;
  addFollowedName: (arg0: string) => Promise<boolean>;
  removeFollowedPeople: (arg0: IPeople) => Promise<boolean>;
  removeFollowedFunction: (arg0: FunctionTags) => Promise<boolean>;
  removeFollowedName: (arg0: string) => Promise<boolean>;
  followsNothing: () => boolean;
}

export interface IOrganisation {
  nom: string;
  wikidataId: WikidataId;
  save: () => Promise<IOrganisation>;
  countDocuments: () => Promise<number>;
}

export interface OrganisationModel extends Model<IOrganisation> {
  findOrCreate: (args: {
    nom: string;
    wikidataId: WikidataId;
  }) => Promise<IOrganisation>;
  countDocuments: () => Promise<number>;
}

export interface UserModel extends Model<IUser> {
  findOrCreate: (session: ISession) => Promise<IUser>;
  countDocuments: () => Promise<number>;
  updateOne: (arg1, arg2?) => Promise<IUser>;
  deleteOne: (args) => Promise<void>;
  create: (args) => Promise<IUser>;
  collection: {
    insertOne(arg): Promise<void>;
    find(arg): FindCursor<IUser>; //  ← cursor, not IUser[]
    findOne(arg): Promise<IUser | null>;
  };
}

export interface IPeople {
  _id: Types.ObjectId;
  nom: string;
  prenom: string;

  createdAt: Date;
  updatedAt: Date;

  save: () => Promise<IPeople>;
  validate: () => Promise<void>;
}

export interface PeopleModel extends Model<IPeople> {
  findOrCreate: (people: { nom: string; prenom: string }) => Promise<IPeople>;
  countDocuments: () => Promise<number>;
  deleteOne: (args) => Promise<void>;
  collection: { insertOne: (arg) => Promise<void> };
}

export type SourceName =
  | "JORF"
  | "BOMI"
  | "BOCNRS"
  | "BOSanté"
  | "BODD"
  | "BOEN"
  | "BOMJ"
  | "BOESR"
  | "BOAC";

export type TypeOrdre =
  | "nomination"
  | "réintégration"
  | "cessation de fonction"
  | "affectation"
  | "délégation de signature"
  | "promotion"
  | "admission"
  | "inscription"
  | "désignation"
  | "détachement"
  | "radiation"
  | "renouvellement"
  | "reconduction"
  | "élection"
  | "admissibilité" // also exists in JORF as "admissibilite"
  | "charge"
  | "intégration"
  | "composition"
  | "habilitation"
  | "titularisation"
  | "recrutement"
  | "disponibilité"
  | "autorisation"
  | "mise à disposition"
  | "décharge"
  | "diplome"
  | "mutation"
  | "décoration"
  | "élévation"
  | "transfert"
  | "conféré"
  | "citation"
  | "démission"
  | "attribution"
  | "reprise de fonctions"
  | "bourse"
  | "fin délégation signature"
  | "prime";

export type WikidataId = string;
