import { describe, expect, beforeEach, it } from "vitest";
import mongoose, { Types } from "mongoose";
import User, {
  MAX_PENDING_NOTIFICATION_RECORDS,
  USER_SCHEMA_VERSION
} from "../models/User.ts";
import { NotificationType, JORFReference } from "../types.ts";

// Build `count` unique refs starting at `start`, e.g. JORFTEXT000123
const makeRefs = (start: number, count: number): JORFReference[] => {
  const refs: JORFReference[] = [];
  for (let i = start; i < start + count; i++)
    refs.push(`JORFTEXT${i.toString().padStart(6, "0")}`);
  return refs;
};

const cappedRecordCount = (
  notifs: { notificationType: NotificationType; source_ids: JORFReference[] }[]
): number =>
  notifs
    .filter(
      (n) => n.notificationType !== "people" && n.notificationType !== "name"
    )
    .reduce((sum, n) => sum + n.source_ids.length, 0);

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

describe("User — insertPendingNotifications record cap", () => {
  beforeEach(async () => {
    if (!mongoose.connection.db)
      throw new Error("MongoDB connection not established");
    await mongoose.connection.db.dropDatabase();
  });

  it("keeps only the latest MAX_PENDING_NOTIFICATION_RECORDS capped records", async () => {
    const user = await makeUser();
    const cap = MAX_PENDING_NOTIFICATION_RECORDS;

    // 4 batches of cap/3 unique refs each -> 4/3 * cap total, oldest batch dropped
    const per = Math.floor(cap / 3);
    let cursor = 0;
    for (let b = 0; b < 4; b++) {
      await User.insertPendingNotifications(
        user._id,
        "Telegram",
        "function",
        makeSourceMap(makeRefs(cursor, per), 1)
      );
      cursor += per;
    }

    const refreshed = await User.findById(user._id);
    if (!refreshed) throw new Error("User not found");

    expect(
      cappedRecordCount(refreshed.pendingNotifications)
    ).toBeLessThanOrEqual(cap);

    const allRefs = refreshed.pendingNotifications.flatMap((n) => n.source_ids);
    // Oldest ref dropped, newest ref kept
    expect(allRefs).not.toContain("JORFTEXT000000");
    expect(allRefs).toContain(
      makeRefs(cursor - 1, 1)[0] // last inserted ref
    );
  });

  it("trims the boundary batch's source_ids when partially over the cap", async () => {
    const user = await makeUser();
    const cap = MAX_PENDING_NOTIFICATION_RECORDS;

    // older batch (cap-50) then newer batch (100) -> total cap+50, keep newest cap
    await User.insertPendingNotifications(
      user._id,
      "Telegram",
      "function",
      makeSourceMap(makeRefs(0, cap - 50), 1)
    );
    await User.insertPendingNotifications(
      user._id,
      "Telegram",
      "function",
      makeSourceMap(makeRefs(cap, 100), 1)
    );

    const refreshed = await User.findById(user._id);
    if (!refreshed) throw new Error("User not found");
    expect(cappedRecordCount(refreshed.pendingNotifications)).toBe(cap);
  });

  it("never drops people or name notifications, even over the cap", async () => {
    const user = await makeUser();
    const cap = MAX_PENDING_NOTIFICATION_RECORDS;

    const peopleRefs = makeRefs(0, 50);
    const nameRefs = makeRefs(1000, 40);

    await User.insertPendingNotifications(
      user._id,
      "Telegram",
      "people",
      makeSourceMap(peopleRefs, 1)
    );
    await User.insertPendingNotifications(
      user._id,
      "Telegram",
      "name",
      makeSourceMap(nameRefs, 1)
    );

    // Flood with capped-type records well beyond the cap
    let cursor = 5000;
    const per = Math.floor(cap / 2);
    for (let b = 0; b < 4; b++) {
      await User.insertPendingNotifications(
        user._id,
        "Telegram",
        "function",
        makeSourceMap(makeRefs(cursor, per), 1)
      );
      cursor += per;
    }

    const refreshed = await User.findById(user._id);
    if (!refreshed) throw new Error("User not found");

    const allRefs = refreshed.pendingNotifications.flatMap((n) => n.source_ids);
    // All people + name refs survive
    for (const ref of [...peopleRefs, ...nameRefs])
      expect(allRefs).toContain(ref);

    // Capped types still bounded
    expect(
      cappedRecordCount(refreshed.pendingNotifications)
    ).toBeLessThanOrEqual(cap);
  });
});
