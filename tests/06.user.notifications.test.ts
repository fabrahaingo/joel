import { describe, expect, beforeEach, it } from "@jest/globals";
import mongoose, { Types } from "mongoose";
import User, { USER_SCHEMA_VERSION } from "../models/User.ts";
import { NotificationType, JORFReference } from "../types.ts";

const makeUser = () =>
  User.create({
    chatId: "notif-chat-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION
  });

const makeSourceMap = (
  refs: JORFReference[],
  countPerRef = 3
): Map<JORFReference, number> => {
  const map = new Map<JORFReference, number>();
  for (const ref of refs) map.set(ref, countPerRef);
  return map;
};

describe("User — insertPendingNotifications", () => {
  beforeEach(async () => {
    if (!mongoose.connection.db)
      throw new Error("MongoDB connection not established");
    await mongoose.connection.db.dropDatabase();
  });

  const notifTypes: NotificationType[] = [
    "people",
    "name",
    "function",
    "organisation",
    "meta"
  ];

  for (const type of notifTypes) {
    it(`inserts a "${type}" notification with correct fields`, async () => {
      const user = await makeUser();
      const refs: JORFReference[] = ["JORFTEXT000001", "JORFTEXT000002"];
      const sources = makeSourceMap(refs, 2);

      await User.insertPendingNotifications(
        user._id,
        "Telegram",
        type,
        sources
      );

      const refreshed = await User.findById(user._id);
      if (!refreshed) throw new Error("User not found");
      expect(refreshed.pendingNotifications.length).toBe(1);

      const notif = refreshed.pendingNotifications[0];
      expect(notif.notificationType).toBe(type);
      expect(notif.source_ids).toEqual(expect.arrayContaining(refs));
      expect(notif.items_nb).toBe(4); // 2 refs × 2 each
      expect(notif.insertDate).toBeInstanceOf(Date);
    });
  }

  it("does not insert duplicate source_ids", async () => {
    const user = await makeUser();
    const ref = "JORFTEXT000001";
    const sources = makeSourceMap([ref], 3);

    await User.insertPendingNotifications(
      user._id,
      "Telegram",
      "people",
      sources
    );
    await User.insertPendingNotifications(
      user._id,
      "Telegram",
      "people",
      sources
    );

    const refreshed = await User.findById(user._id);
    if (!refreshed) throw new Error("User not found");
    expect(refreshed.pendingNotifications.length).toBe(1);
  });

  it("skips sources already present but inserts new ones in the same call", async () => {
    const user = await makeUser();
    const existing = "JORFTEXT000001";
    const newRef = "JORFTEXT000002";

    await User.insertPendingNotifications(
      user._id,
      "Telegram",
      "people",
      makeSourceMap([existing], 1)
    );

    await User.insertPendingNotifications(
      user._id,
      "Telegram",
      "people",
      makeSourceMap([existing, newRef], 1)
    );

    const refreshed = await User.findById(user._id);
    if (!refreshed) throw new Error("User not found");
    // Second call inserts only the new ref
    expect(refreshed.pendingNotifications.length).toBe(2);
    const secondNotif = refreshed.pendingNotifications[1];
    expect(secondNotif.source_ids).toEqual([newRef]);
  });

  it("does nothing for unknown userId", async () => {
    const fakeId = new Types.ObjectId();
    // Should not throw — just log and return
    await expect(
      User.insertPendingNotifications(
        fakeId,
        "Telegram",
        "people",
        makeSourceMap(["JORFTEXT000001"])
      )
    ).resolves.toBeUndefined();
  });

  it("does nothing when sources map is empty", async () => {
    const user = await makeUser();
    await User.insertPendingNotifications(
      user._id,
      "Telegram",
      "people",
      new Map()
    );
    const refreshed = await User.findById(user._id);
    if (!refreshed) throw new Error("User not found");
    expect(refreshed.pendingNotifications.length).toBe(0);
  });
});
