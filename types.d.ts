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

export interface IUser {
  _id: number;
  chatId: number;
  language_code: string;
  status: string;
  followedPeople: {
    peopleId: Types.ObjectId;
    lastUpdate: Date;
  }[];
  followedFunctions: FunctionTags[];
  save: () => Promise<IUser>;
  countDocuments: () => number;
}

export interface UserModel extends Model<IUser> {
  firstOrCreate: (args: {
    tgUser: TelegramBot.User | undefined;
    chatId: number;
  }) => Promise<IUser>;
}

export interface IBlocked {
  chatId: number;
}

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
  | "admissibilite";
