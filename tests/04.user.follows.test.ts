import { describe, expect, beforeEach, it } from "@jest/globals";
import mongoose from "mongoose";
import User, { USER_SCHEMA_VERSION } from "../models/User.ts";
import People from "../models/People.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";

const makeUser = () =>
  User.create({
    chatId: "chat-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION
  });

const makePerson = (nom = "Dupont", prenom = "Jean") =>
  People.create({ nom, prenom });

describe("User — follow/unfollow/check methods", () => {
  beforeEach(async () => {
    if (!mongoose.connection.db)
      throw new Error("MongoDB connection not established");
    await mongoose.connection.db.dropDatabase();
  });

  describe("People", () => {
    it("checkFollowedPeople returns false before following", async () => {
      const user = await makeUser();
      const person = await makePerson();
      expect(user.checkFollowedPeople(person)).toBe(false);
    });

    it("addFollowedPeople returns true and person is followed", async () => {
      const user = await makeUser();
      const person = await makePerson();
      const result = await user.addFollowedPeople(person);
      expect(result).toBe(true);
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.checkFollowedPeople(person)).toBe(true);
    });

    it("addFollowedPeople is idempotent — second call returns false, no duplicate", async () => {
      const user = await makeUser();
      const person = await makePerson();
      await user.addFollowedPeople(person);
      const second = await user.addFollowedPeople(person);
      expect(second).toBe(false);
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.followedPeople.length).toBe(1);
    });

    it("removeFollowedPeople returns true and person is no longer followed", async () => {
      const user = await makeUser();
      const person = await makePerson();
      await user.addFollowedPeople(person);
      const removed = await user.removeFollowedPeople(person);
      expect(removed).toBe(true);
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.checkFollowedPeople(person)).toBe(false);
    });

    it("removeFollowedPeople on non-followed person returns false", async () => {
      const user = await makeUser();
      const person = await makePerson();
      expect(await user.removeFollowedPeople(person)).toBe(false);
    });

    it("addFollowedPeopleBulk adds multiple people", async () => {
      const user = await makeUser();
      const p1 = await makePerson("Martin", "Alice");
      const p2 = await makePerson("Bernard", "Bob");
      await user.addFollowedPeopleBulk([p1, p2]);
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.followedPeople.length).toBe(2);
    });

    it("addFollowedPeopleBulk is idempotent — partial overlap skips existing", async () => {
      const user = await makeUser();
      const p1 = await makePerson("Martin", "Alice");
      const p2 = await makePerson("Bernard", "Bob");
      await user.addFollowedPeople(p1);
      await user.addFollowedPeopleBulk([p1, p2]);
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.followedPeople.length).toBe(2);
    });

    it("addFollowedPeopleBulk on empty array returns true without error", async () => {
      const user = await makeUser();
      expect(await user.addFollowedPeopleBulk([])).toBe(true);
    });
  });

  describe("Functions", () => {
    it("checkFollowedFunction returns false before following", async () => {
      const user = await makeUser();
      expect(user.checkFollowedFunction(FunctionTags.Ambassadeur)).toBe(false);
    });

    it("addFollowedFunction returns true and function is followed", async () => {
      const user = await makeUser();
      expect(await user.addFollowedFunction(FunctionTags.Ambassadeur)).toBe(
        true
      );
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.checkFollowedFunction(FunctionTags.Ambassadeur)).toBe(
        true
      );
    });

    it("addFollowedFunction is idempotent", async () => {
      const user = await makeUser();
      await user.addFollowedFunction(FunctionTags.Ambassadeur);
      expect(await user.addFollowedFunction(FunctionTags.Ambassadeur)).toBe(
        false
      );
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.followedFunctions.length).toBe(1);
    });

    it("removeFollowedFunction returns true and function is gone", async () => {
      const user = await makeUser();
      await user.addFollowedFunction(FunctionTags.Ambassadeur);
      expect(await user.removeFollowedFunction(FunctionTags.Ambassadeur)).toBe(
        true
      );
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.checkFollowedFunction(FunctionTags.Ambassadeur)).toBe(
        false
      );
    });

    it("removeFollowedFunction on non-followed returns false", async () => {
      const user = await makeUser();
      expect(await user.removeFollowedFunction(FunctionTags.Ambassadeur)).toBe(
        false
      );
    });

    it("can follow multiple distinct functions", async () => {
      const user = await makeUser();
      await user.addFollowedFunction(FunctionTags.Ambassadeur);
      await user.addFollowedFunction(FunctionTags.Consul);
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.followedFunctions.length).toBe(2);
    });
  });

  describe("Names", () => {
    it("checkFollowedName returns false before following", async () => {
      const user = await makeUser();
      expect(user.checkFollowedName("Dupont")).toBe(false);
    });

    it("addFollowedName returns true and name is followed", async () => {
      const user = await makeUser();
      expect(await user.addFollowedName("Dupont")).toBe(true);
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.checkFollowedName("Dupont")).toBe(true);
    });

    it("addFollowedName is idempotent (case insensitive)", async () => {
      const user = await makeUser();
      await user.addFollowedName("Dupont");
      expect(await user.addFollowedName("DUPONT")).toBe(false);
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.followedNames.length).toBe(1);
    });

    it("removeFollowedName returns true and name is gone", async () => {
      const user = await makeUser();
      await user.addFollowedName("Dupont");
      expect(await user.removeFollowedName("Dupont")).toBe(true);
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.checkFollowedName("Dupont")).toBe(false);
    });

    it("removeFollowedName on non-followed returns false", async () => {
      const user = await makeUser();
      expect(await user.removeFollowedName("Dupont")).toBe(false);
    });
  });

  describe("Alert strings", () => {
    it("checkFollowedAlertString returns false before following", async () => {
      const user = await makeUser();
      expect(user.checkFollowedAlertString("éducation nationale")).toBe(false);
    });

    it("addFollowedAlertString returns true and string is followed", async () => {
      const user = await makeUser();
      expect(await user.addFollowedAlertString("éducation nationale")).toBe(
        true
      );
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.checkFollowedAlertString("éducation nationale")).toBe(
        true
      );
    });

    it("addFollowedAlertString is idempotent (case insensitive)", async () => {
      const user = await makeUser();
      await user.addFollowedAlertString("éducation nationale");
      expect(await user.addFollowedAlertString("Éducation Nationale")).toBe(
        false
      );
    });

    it("addFollowedAlertString trims whitespace", async () => {
      const user = await makeUser();
      await user.addFollowedAlertString("  décret  ");
      expect(await user.addFollowedAlertString("décret")).toBe(false);
    });

    it("removeFollowedAlertString returns true and string is gone", async () => {
      const user = await makeUser();
      await user.addFollowedAlertString("éducation nationale");
      expect(await user.removeFollowedAlertString("éducation nationale")).toBe(
        true
      );
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.checkFollowedAlertString("éducation nationale")).toBe(
        false
      );
    });

    it("removeFollowedAlertString on non-followed returns false", async () => {
      const user = await makeUser();
      expect(await user.removeFollowedAlertString("éducation")).toBe(false);
    });
  });

  describe("Organisations", () => {
    it("checkFollowedOrganisation returns false before following", async () => {
      const user = await makeUser();
      expect(user.checkFollowedOrganisation("Q123456")).toBe(false);
    });

    it("addFollowedOrganisation (string wikidataId) returns true and org is followed", async () => {
      const user = await makeUser();
      expect(await user.addFollowedOrganisation("Q123456")).toBe(true);
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.checkFollowedOrganisation("Q123456")).toBe(true);
    });

    it("addFollowedOrganisation is idempotent", async () => {
      const user = await makeUser();
      await user.addFollowedOrganisation("Q123456");
      expect(await user.addFollowedOrganisation("Q123456")).toBe(false);
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.followedOrganisations.length).toBe(1);
    });

    it("removeFollowedOrganisation returns true and org is gone", async () => {
      const user = await makeUser();
      await user.addFollowedOrganisation("Q123456");
      expect(await user.removeFollowedOrganisation("Q123456")).toBe(true);
      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.checkFollowedOrganisation("Q123456")).toBe(false);
    });

    it("removeFollowedOrganisation on non-followed returns false", async () => {
      const user = await makeUser();
      expect(await user.removeFollowedOrganisation("Q999")).toBe(false);
    });
  });

  describe("followsNothing", () => {
    it("returns true on a fresh user", async () => {
      const user = await makeUser();
      expect(user.followsNothing()).toBe(true);
    });

    it("returns false after following a person", async () => {
      const user = await makeUser();
      const person = await makePerson();
      await user.addFollowedPeople(person);
      expect(user.followsNothing()).toBe(false);
    });

    it("returns false after following a function", async () => {
      const user = await makeUser();
      await user.addFollowedFunction(FunctionTags.Ambassadeur);
      expect(user.followsNothing()).toBe(false);
    });

    it("returns false after following a name", async () => {
      const user = await makeUser();
      await user.addFollowedName("Martin");
      expect(user.followsNothing()).toBe(false);
    });

    it("returns false after following an alert string", async () => {
      const user = await makeUser();
      await user.addFollowedAlertString("décret");
      expect(user.followsNothing()).toBe(false);
    });

    it("returns false after following an organisation", async () => {
      const user = await makeUser();
      await user.addFollowedOrganisation("Q1");
      expect(user.followsNothing()).toBe(false);
    });

    it("returns true after unfollowing the only item", async () => {
      const user = await makeUser();
      await user.addFollowedAlertString("décret");
      await user.removeFollowedAlertString("décret");
      expect(user.followsNothing()).toBe(true);
    });
  });
});
