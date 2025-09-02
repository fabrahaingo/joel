import { FunctionTags } from "../entities/FunctionTags.ts";
import { Document, Types } from "mongoose";
import { IUser, MessageApp, WikidataId } from "../types.ts";

export type IRawUser = LegacyRawUser_V2 | IUser;

export interface LegacyRawUser_V2 extends Document {
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
}
