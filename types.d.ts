import { Model, Types } from "mongoose.js";
import { FunctionTags } from "./entities/FunctionTags.js";
import umami from "./utils/umami.js";

export type CommandType = {
  regex: RegExp;
  action: (session: ISession, msg?: string) => Promise<void>;
};

export type MessageApp =
  | "Telegram";
//| "WhatsApp";
//| "Matrix";

export interface ISession {
    messageApp: MessageApp;
    chatId: number;
    language_code: string;
    user: IUser | null | undefined;
    isReply: boolean;

    loadUser: () => Promise<void>;
    createUser: () => Promise<void>;
    sendMessage: (msg: string, keyboard?: { text: string }[][]) => Promise<void>;
    sendTypingAction: () => Promise<void>;
    log: typeof umami.log;
}

// fields are undefined for users created before implementation
export interface IUser {
  _id: number;
  messageApp?: MessageApp;
  chatId: number;
  language_code: string;
  status: string;
  lastInteractionDay?: Date;
  lastInteractionWeek?: Date;
  lastInteractionMonth?: Date;
  followedPeople: {
    peopleId: Types.ObjectId;
    lastUpdate: Date;
  }[];
  followedNames?: string[];
  followedOrganisations?: {
    wikidataId: WikidataId;
    lastUpdate: Date;
  }[];
  followedFunctions: FunctionTags[];
  save: () => Promise<IUser>;
  countDocuments: () => number;

  updateInteractionMetrics: () => Promise<void>;

  checkFollowedPeople: (arg0: IPeople) => boolean;
  checkFollowedFunction: (arg0: FunctionTags) => boolean;
  addFollowedPeople: (arg0: IPeople) => Promise<boolean>;
  addFollowedPeopleBulk: (arg0: IPeople[]) => Promise<boolean>;
  addFollowedFunction: (arg0: FunctionTags) => Promise<boolean>;
  removeFollowedPeople: (arg0: IPeople) => Promise<boolean>;
  removeFollowedFunction: (arg0: FunctionTags) => Promise<boolean>;
  followsNothing: () => boolean;
}

export interface IOrganisation {
    nom: string;
    wikidataId: WikidataId;
    save: () => Promise<IOrganisation>;
    countDocuments: () => number;
}

export interface OrganisationModel extends Model<IOrganisation> {
    firstOrCreate: (args: {
        nom: string;
        wikidataId: WikidataId;
    }) => Promise<IOrganisation>;
}

export interface UserModel extends Model<IUser> {
  findOrCreate: (session: ISession) => Promise<IUser>;
}

export type IBlocked = {
  chatId: string;
};

export interface IPeople {
  _id: Types.ObjectId;
  nom: string;
  prenom: string;
  save: () => Promise<IPeople>;
  countDocuments: () => number;
}

export interface PeopleModel extends Model<IPeople> {
  firstOrCreate: (people: {
    nom: string;
    prenom: string;
  }) => Promise<IPeople>;
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