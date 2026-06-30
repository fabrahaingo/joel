import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn(() => Promise.resolve()) }
}));
const { logErrorSpy } = vi.hoisted(() => ({
  logErrorSpy: vi.fn(() => Promise.resolve())
}));
vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));

import User, { USER_SCHEMA_VERSION } from "../models/User.ts";
import {
  loadUser,
  migrateUser,
  recordSuccessfulDelivery,
  messageReceivedTimeHistory
} from "../entities/Session.ts";
import type { ISession } from "../types.ts";

const makeUser = (over: Record<string, unknown> = {}) =>
  User.create({
    chatId: "chat-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION,
    ...over
  });

const sessionFor = (chatId: string, over: Partial<ISession> = {}): ISession =>
  ({
    messageApp: "Telegram",
    chatId,
    language_code: "fr",
    user: null,
    isReply: false,
    lastEngagementAt: new Date(),
    loadUser: () => Promise.resolve(null),
    createUser: () => Promise.resolve(),
    sendMessage: vi.fn(() => Promise.resolve(true)),
    sendTypingAction: () => undefined,
    log: () => undefined,
    extractMessageAppsOptions: () => ({}),
    ...over
  }) as unknown as ISession;

beforeEach(async () => {
  if (!mongoose.connection.db)
    throw new Error("MongoDB connection not established");
  await mongoose.connection.db.dropDatabase();
  vi.clearAllMocks();
});

describe("loadUser", () => {
  it("returns the cached session.user without querying", async () => {
    const cached = { _id: "x" } as unknown as ISession["user"];
    const user = await loadUser(sessionFor("c1", { user: cached }));
    expect(user).toBe(cached);
  });

  it("returns null when no matching user exists", async () => {
    expect(await loadUser(sessionFor("missing"))).toBeNull();
  });

  it("deletes and returns null when the user follows nothing", async () => {
    const u = await makeUser({ chatId: "follows-nothing" });
    const res = await loadUser(sessionFor("follows-nothing"));
    expect(res).toBeNull();
    expect(await User.findById(u._id)).toBeNull();
  });

  it("clears expired transferData", async () => {
    const u = await makeUser({
      chatId: "transfer",
      followedNames: ["X"],
      transferData: { code: "abc", expiresAt: new Date(Date.now() - 1000) }
    });
    const res = await loadUser(sessionFor("transfer"));
    expect(res).not.toBeNull();
    const refreshed = await User.findById(u._id);
    expect(refreshed?.transferData).toBeUndefined();
  });

  it("persists a changed roomId", async () => {
    const u = await makeUser({
      chatId: "room",
      messageApp: "Matrix",
      roomId: "!old:hs",
      followedNames: ["X"]
    });
    await loadUser(
      sessionFor("room", { messageApp: "Matrix", roomId: "!new:hs" })
    );
    const refreshed = await User.findById(u._id);
    expect(refreshed?.roomId).toBe("!new:hs");
  });

  it("logs, notifies the user and returns null when duplicates exist", async () => {
    // Index is dropped by dropDatabase mid-run, so duplicates can be inserted.
    await User.collection.insertMany([
      {
        messageApp: "Telegram",
        chatId: "dup",
        schemaVersion: USER_SCHEMA_VERSION
      },
      {
        messageApp: "Telegram",
        chatId: "dup",
        schemaVersion: USER_SCHEMA_VERSION
      }
    ]);
    const session = sessionFor("dup");
    const res = await loadUser(session);
    expect(res).toBeNull();
    expect(session.sendMessage).toHaveBeenCalled();
    expect(logErrorSpy).toHaveBeenCalled();
  });
});

describe("migrateUser", () => {
  it("returns early when already on the current schema version", async () => {
    await expect(
      migrateUser({ schemaVersion: USER_SCHEMA_VERSION } as never)
    ).resolves.toBeUndefined();
  });

  it("migrates a legacy (v2) record to v3", async () => {
    await User.collection.insertOne({
      messageApp: "Telegram",
      chatId: 12345,
      schemaVersion: 2
    });
    await migrateUser({
      schemaVersion: 2,
      messageApp: "Telegram",
      chatId: 12345
    } as never);
    const doc = await User.collection.findOne({ chatId: "12345" });
    expect(doc?.schemaVersion).toBe(3);
  });

  it("throws on an unknown (future) schema version", async () => {
    await expect(migrateUser({ schemaVersion: 99 } as never)).rejects.toThrow(
      "Unknown schema version"
    );
  });

  it("logs (without throwing) when the legacy update fails", async () => {
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const updSpy = vi
      .spyOn(User.collection, "updateOne")
      .mockRejectedValueOnce(new Error("db down"));
    await expect(
      migrateUser({
        schemaVersion: 2,
        messageApp: "Telegram",
        chatId: 777
      } as never)
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith("Migration failed:", expect.any(Error));
    updSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe("recordSuccessfulDelivery", () => {
  it("snapshots the previous receive time and marks the user active", async () => {
    const previous = new Date(Date.now() - 5 * 60 * 1000);
    await makeUser({
      chatId: "rsd",
      status: "blocked",
      lastMessageReceivedAt: previous
    });
    await recordSuccessfulDelivery("Telegram", "rsd");
    expect(messageReceivedTimeHistory.get("Telegram:rsd")?.getTime()).toBe(
      previous.getTime()
    );
    const refreshed = await User.findOne({
      messageApp: "Telegram",
      chatId: "rsd"
    });
    expect(refreshed?.status).toBe("active");
    expect(refreshed?.lastMessageReceivedAt.getTime()).toBeGreaterThan(
      previous.getTime()
    );
  });

  it("is a no-op when the user does not exist", async () => {
    await expect(
      recordSuccessfulDelivery("Telegram", "ghost")
    ).resolves.toBeUndefined();
  });
});
