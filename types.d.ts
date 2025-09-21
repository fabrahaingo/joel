import { Model, Types } from "mongoose";
import { FunctionTags } from "./entities/FunctionTags";
import { Keyboard } from "./Keyboard.ts";
import umami from "./utils/umami";

export interface CommandType {
  regex: RegExp;
  action: (session: ISession, msg: string) => Promise<void>;
}

export type MessageApp = "Telegram" | "WhatsApp" | "Signal" | "Matrix";

export interface ISession {
  messageApp: MessageApp;
  chatId: string;
  language_code: string;
  user: IUser | null | undefined;
  isReply: boolean | undefined;

  loadUser: () => Promise<void>;
  createUser: () => Promise<void>;
  sendMessage: (
    msg: string,
    keyboard?: Keyboard,
    options?: {
      forceNoKeyboard?: boolean;
    }
  ) => Promise<void>;
  sendTypingAction: () => Promise<void>;
  log: typeof umami.log;
}

// fields are undefined for users created before implementation
export interface IUser {
  _id: Types.ObjectId;
  messageApp: MessageApp;
  chatId: string;
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
}

export interface OrganisationModel extends Model<IOrganisation> {
  findOrCreate: (args: {
    nom: string;
    wikidataId: WikidataId;
  }) => Promise<IOrganisation>;
}

export interface UserModel extends Model<IUser> {
  findOrCreate: (session: ISession) => Promise<IUser>;
  deleteOne: (args) => Promise<void>;
  create: (args) => Promise<IUser>;
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
