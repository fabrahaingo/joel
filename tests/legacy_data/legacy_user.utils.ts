import { model, Model, Schema, Types } from "mongoose";
import TelegramBot = require("node-telegram-bot-api");
import { ObjectId } from "mongodb";

export type TestLegacyIUser = {
  _id: number;
  chatId: number;
  language_code: string;
  status: string;
  followedPeople: Array<{
    peopleId: Types.ObjectId;
    lastUpdate: Date;
  }>;
  followedFunctions: Array<string>;
  save: () => Promise<TestLegacyIUser>;
};

const TestLegacyUserSchema = new Schema<TestLegacyIUser, TestLegacyUserModel>(
  {
    _id: {
      type: Number,
      required: true,
    },
    chatId: {
      type: Number,
      required: true,
    },
    language_code: {
      type: String,
      required: true,
      default: "fr",
    },
    status: {
      type: String,
      enum: ["active", "blocked"],
      default: "active",
    },
    followedPeople: {
      type: [
        {
          peopleId: {
            type: Types.ObjectId,
          },
          lastUpdate: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      default: [],
    },
    followedFunctions: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    _id: false,
  },
);

export interface TestLegacyUserModel extends Model<TestLegacyIUser> {
  firstOrCreate: (args: {
    tgUser: TelegramBot.User | undefined;
    chatId: number;
  }) => Promise<TestLegacyIUser>;
}

const TestLegacyUser = model<TestLegacyIUser, TestLegacyUserModel>(
  "User",
  TestLegacyUserSchema,
);

const legacyUserData = {
  _id: 19929299,
  chatId: 19929299,
  language_code: "fr",
  status: "active",
  followedPeople: [
    {
      peopleId: ObjectId.createFromHexString("67e1d0ad7179149177b0a049"),
      lastUpdate: Date.now(),
    },
    {
      peopleId: ObjectId.createFromHexString("67e1d0b27179149177b0a04f"),
      lastUpdate: Date.now(),
    },
  ],
  followedFunctions: [
    "secretaire_general_de_prefecture",
    "tribunal_grande_instance",
  ],
};

export async function TestSaveLegacyUser(): Promise<{
  data: typeof legacyUserData; // raw data
  user: TestLegacyIUser; // document
}> {
  const user = new TestLegacyUser(legacyUserData);
  const savedUser = await user.save();
  return { data: legacyUserData, user: savedUser };
}
