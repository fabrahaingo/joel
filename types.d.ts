import { Model, Types } from "mongoose";
import { JORFSearchItem } from "./entities/JORFSearchResponse";
import { FunctionTags } from "./entities/FunctionTags";
import TelegramBot from "node-telegram-bot-api";

export type CommandType = {
  regex: RegExp;
  action: (bot: TelegramBot) => (msg: TelegramBot.Message) => {
    default: void;
  };
}[];

export type MessageApp =
  | "Telegram";
//| "WhatsApp";
//| "Matrix";

export interface IUser {
  _id: number;
  messageApp?: MessageApp; // undefined for user created before it was added
  chatId: number;
  language_code: string;
  status: string;
  followedPeople: {
    peopleId: Types.ObjectId;
    lastUpdate: Date;
  }[];
  followedNames: string[] | undefined; // undefined for user created before it was added
  followedFunctions: FunctionTags[];
  save: () => Promise<IUser>;
  countDocuments: () => number;
}

export interface UserModel extends Model<IUser> {
  firstOrCreate: (args: {
    tgUser: TelegramBot.User;
    chatId: number;
    messageApp: MessageApp;
  }) => Promise<IUser | null>; // null means that the user is a bot
}

export type IBlocked = {
  chatId: string;
};

export interface IPeople {
  _id: Types.ObjectId;
  nom: string;
  prenom: string;
  lastKnownPosition: JORFSearchItem;
  save: () => Promise<IPeople>;
  countDocuments: () => number;
}

export interface PeopleModel extends Model<IPeople> {
  firstOrCreate: (people: {
    nom: string;
    prenom: string;
    lastKnownPosition: JORFSearchItem;
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

export type WikiDataId = string;