import { expect } from "@jest/globals";
import { dbHelper } from "./dbHelper";
import { TestSaveLegacyUser } from "./legacy_data/legacy_user.utils";
import { ObjectId } from "mongodb";
import { Types } from "mongoose";

beforeAll(async () => {
  await dbHelper.setup();
});

// Delete the legacy user model to prevent OverwriteModelError
/*
afterAll(async () => {
  mongoose.deleteModel("People");
});
*/

describe("Legacy user saving", () => {
  it("should save a legacy user in the db", async () => {
    const legacyUser = await TestSaveLegacyUser();

    expect(legacyUser.user.chatId).toBe(legacyUser.data.chatId);
    expect(legacyUser.user.language_code).toEqual(
      legacyUser.data.language_code,
    );
    expect(legacyUser.user.status).toEqual(legacyUser.data.status);
    expect(
      !legacyUser.user.followedPeople.some(
        (i, idx) =>
          !i.peopleId.equals(legacyUser.data.followedPeople[idx].peopleId) ||
          i.lastUpdate.getTime() !==
            legacyUser.data.followedPeople[idx].lastUpdate,
      ),
    );
    expect(legacyUser.user.followedFunctions).toEqual(
      legacyUser.data.followedFunctions,
    );
  });
});
