import { FunctionTags } from "../entities/FunctionTags.ts";
import { Document, Types } from "mongoose";
import { IUser } from "../types.ts";

export type IRawUser = LegacyUser_V1 | IUser;

export interface LegacyUser_V1 extends Document {
  _id: number | string | Types.ObjectId;
  chatId: number;
  language_code?: string;
  status?: string;
  followedPeople?: {
    peopleId: Types.ObjectId;
    lastUpdate: Date;
  }[];
  followedFunctions?: FunctionTags[];
  schemaVersion?: number;

  save: () => Promise<never>;
}
