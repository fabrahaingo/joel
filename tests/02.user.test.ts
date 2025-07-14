import { expect } from "@jest/globals";
import mongoose from "mongoose";
import User from "../models/User.ts";
import { ISession, IUser } from "../types.ts";
import { ChatId } from "node-telegram-bot-api";

describe("User Model Test Suite", () => {
  let mdb: typeof mongoose.connection.db;

  beforeAll(() => {
    mdb = mongoose.connection.db;
  });

  beforeEach(async () => {
    if (!mongoose.connection.db)
      throw new Error("MongoDB connection not established");
    await mongoose.connection.db.dropDatabase();
  });

  const userMockChatId = 12346789 as ChatId;

  const MockTelegramSession = {
    chatId: userMockChatId,
    messageApp: "Telegram",
    language_code: "fr",
    user: undefined
  } as unknown as ISession;

  const legacyUserData = {
    //_id: Types.ObjectId: not here as the record is inserted
    chatId: userMockChatId,
    messageApp: "Telegram",
    language_code: "fr",
    status: "active",
    followedPeople: undefined,
    followedFunctions: undefined,
    followedNames: undefined,
    followedOrganisations: undefined,
    schemaVersion: undefined,
    createAt: Date.now(),
    updatedAt: Date.now()
  };

  const currentUserData = {
    //_id: Types.ObjectId: not here as the record is inserted
    chatId: userMockChatId,
    messageApp: "Telegram",
    language_code: "en",
    status: "active",
    followedPeople: [],
    followedFunctions: [],
    followedNames: [],
    followedOrganisations: [],
    lastInteractionDay: Date.now(),
    lastInteractionMonth: Date.now(),
    lastInteractionWeek: Date.now(),
    schemaVersion: 2,
    createAt: Date.now(),
    updatedAt: Date.now()
  };

  // Only need to be checked for the current user schema
  describe("Schema Validation", () => {
    it("should convert and validate legacy users", async () => {
      if (!mdb) throw new Error("MongoDB connection not established");

      await User.collection.insertOne(legacyUserData);
      const legacyUser: IUser = await User.findOrCreate(MockTelegramSession);
      expect(legacyUser).not.toBeNull();
      await expect(legacyUser.validate()).resolves.toBeUndefined(); // undefined = validation passed

      expect(legacyUser.schemaVersion).toBe(2);
      expect(legacyUser.messageApp).toBe("Telegram");
      expect(legacyUser.followedPeople).toEqual([]);
      expect(legacyUser.followedFunctions).toEqual([]);
      expect(legacyUser.followedNames).toEqual([]);
    });
  });
});
