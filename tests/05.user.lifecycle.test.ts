import { describe, expect, beforeEach, it } from "vitest";
import mongoose from "mongoose";
import User, { USER_SCHEMA_VERSION } from "../models/User.ts";
import { ISession } from "../types.ts";

const makeSession = (chatId: string): ISession =>
  ({
    messageApp: "Telegram",
    chatId,
    language_code: "fr",
    user: null,
    isReply: false,
    lastEngagementAt: new Date(),
    loadUser: () => Promise.resolve(null),
    createUser: () => Promise.resolve(),
    sendMessage: () => Promise.resolve(true),
    sendTypingAction: () => undefined,
    log: () => undefined,
    extractMessageAppsOptions: () => ({})
  }) as unknown as ISession;

const makeUser = (overrides: Record<string, unknown> = {}) =>
  User.create({
    chatId: "chat-" + Math.random().toString(36).slice(2),
    messageApp: "Telegram",
    schemaVersion: USER_SCHEMA_VERSION,
    ...overrides
  });

describe("User — findOrCreate", () => {
  beforeEach(async () => {
    if (!mongoose.connection.db)
      throw new Error("MongoDB connection not established");
    await mongoose.connection.db.dropDatabase();
  });

  it("creates a new user when none exists", async () => {
    const session = makeSession("new-chat-001");
    const user = await User.findOrCreate(session);
    expect(user.chatId).toBe("new-chat-001");
    expect(user.messageApp).toBe("Telegram");
    expect(user.schemaVersion).toBe(USER_SCHEMA_VERSION);
    expect(user.status).toBe("active");
    const count = await User.countDocuments();
    expect(count).toBe(1);
  });

  it("returns existing user on second call (user must follow something to survive loadUser)", async () => {
    const session = makeSession("existing-chat-002");
    const created = await User.findOrCreate(session);
    // Add a follow so loadUser doesn't delete the user (followsNothing guard)
    await created.addFollowedAlertString("test");

    const found = await User.findOrCreate(session);
    expect(found._id.toString()).toBe(created._id.toString());
    expect(await User.countDocuments()).toBe(1);
  });

  it("uses chatId and messageApp from session", async () => {
    const session = makeSession("specific-chat-999");
    const user = await User.findOrCreate(session);
    expect(user.chatId).toBe("specific-chat-999");
    expect(user.messageApp).toBe("Telegram");
  });

  it("creates distinct users for different chatIds", async () => {
    await makeUser({ chatId: "distinct-chat-A" });
    await makeUser({ chatId: "distinct-chat-B" });
    expect(await User.countDocuments()).toBe(2);
  });
});

describe("User — updateInteractionMetrics", () => {
  beforeEach(async () => {
    if (!mongoose.connection.db)
      throw new Error("MongoDB connection not established");
    await mongoose.connection.db.dropDatabase();
  });

  it("unblocks a blocked user", async () => {
    const user = await makeUser({ status: "blocked" });
    expect(user.status).toBe("blocked");
    await user.updateInteractionMetrics();
    const refreshed = await User.findById(user._id);
    if (!refreshed) throw new Error("User not found");
    expect(refreshed.status).toBe("active");
  });

  it("does not update lastInteractionDay when called twice on same day", async () => {
    const user = await makeUser();
    await user.updateInteractionMetrics();
    const after1 = await User.findById(user._id);
    if (!after1) throw new Error("User not found");
    const dayAfter1 = after1.lastInteractionDay;

    await user.updateInteractionMetrics();
    const after2 = await User.findById(user._id);
    if (!after2) throw new Error("User not found");
    expect(after2.lastInteractionDay.getTime()).toBe(dayAfter1.getTime());
  });

  it("updates lastInteractionDay when lastInteractionDay is yesterday", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const user = await makeUser({ lastInteractionDay: yesterday });

    const dayBefore = user.lastInteractionDay;
    await user.updateInteractionMetrics();

    const refreshed = await User.findById(user._id);
    if (!refreshed) throw new Error("User not found");
    expect(refreshed.lastInteractionDay.toDateString()).not.toBe(
      dayBefore.toDateString()
    );
  });

  it("updates lastInteractionWeek when last interaction was 8 days ago", async () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
    const user = await makeUser({
      lastInteractionDay: eightDaysAgo,
      lastInteractionWeek: eightDaysAgo
    });

    await user.updateInteractionMetrics();

    const refreshed = await User.findById(user._id);
    if (!refreshed) throw new Error("User not found");
    expect(refreshed.lastInteractionWeek.getTime()).toBeGreaterThan(
      eightDaysAgo.getTime()
    );
  });

  it("updates lastInteractionMonth when last interaction was last month", async () => {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const user = await makeUser({ lastInteractionMonth: lastMonth });

    await user.updateInteractionMetrics();

    const refreshed = await User.findById(user._id);
    if (!refreshed) throw new Error("User not found");
    expect(refreshed.lastInteractionMonth.getMonth()).toBe(
      new Date().getMonth()
    );
  });

  it("sets waitingReengagement to false", async () => {
    const user = await makeUser({ waitingReengagement: true });
    await user.updateInteractionMetrics();
    const refreshed = await User.findById(user._id);
    if (!refreshed) throw new Error("User not found");
    expect(refreshed.waitingReengagement).toBe(false);
  });
});
