import { Model, Types } from "mongoose";
import TelegramBot from "node-telegram-bot-api";
import { FunctionTags } from "./entities/FunctionTags";

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
  followedFunctions: Array<{
    functionTag: FunctionTags;
    lastUpdate: Date;
  }>;
  save: () => Promise<IUser>;
  countDocuments: () => any;
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
  countDocuments: () => any;
};

export interface PeopleModel extends Model<IPeople> {
  firstOrCreate: (people: any) => Promise<IPeople>;
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
