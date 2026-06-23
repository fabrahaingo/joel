import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import {
  dispatchTasksToMessageApps,
  NotificationTask
} from "../notifications/notificationDispatch.ts";
import type { ExtendedMiniUserInfo } from "../entities/Session.ts";
import type { MessageApp } from "../types.ts";

// Pure ordering test for the dispatcher: no DB, no network. We feed tasks and a
// taskFunction that just records the order in which it was invoked per app.

const DAY_MS = 24 * 60 * 60 * 1000;

const makeTask = (
  label: string,
  messageApp: MessageApp,
  lastEngagementMsAgo: number,
  recordCount: number
): NotificationTask<string> => {
  const userInfo: ExtendedMiniUserInfo = {
    messageApp,
    chatId: label,
    status: "active",
    hasAccount: true,
    waitingReengagement: false,
    lastEngagementAt: new Date(Date.now() - lastEngagementMsAgo)
  };
  return {
    userId: new Types.ObjectId(),
    userInfo,
    updatedRecordsMap: new Map<string, never[]>(),
    recordCount
  };
};

// Run the dispatcher and return the chatId labels in the order they were sent,
// grouped by app (apps run concurrently, but order *within* an app is what we assert).
const dispatchAndRecord = async (
  tasks: NotificationTask<string>[]
): Promise<Map<MessageApp, string[]>> => {
  const orderByApp = new Map<MessageApp, string[]>();
  await dispatchTasksToMessageApps<string>(tasks, async (task) => {
    const app = task.userInfo.messageApp;
    orderByApp.set(
      app,
      (orderByApp.get(app) ?? []).concat(task.userInfo.chatId)
    );
    await Promise.resolve();
  });
  return orderByApp;
};

describe("dispatchTasksToMessageApps — WhatsApp edge-first ordering", () => {
  it("sends WhatsApp users closest to their 24h window edge first", async () => {
    // older lastEngagementAt == closer to expiry == must go first
    const tasks = [
      makeTask("wh-fresh", "WhatsApp", 1 * 60 * 60 * 1000, 50), // 1h ago
      makeTask("wh-edge", "WhatsApp", DAY_MS - 5 * 60 * 1000, 1), // ~at edge
      makeTask("wh-mid", "WhatsApp", 12 * 60 * 60 * 1000, 99) // 12h ago
    ];

    const order = await dispatchAndRecord(tasks);

    expect(order.get("WhatsApp")).toEqual(["wh-edge", "wh-mid", "wh-fresh"]);
  });

  it("uses record count only as a tiebreaker when window edges are equal", async () => {
    const tasks = [
      makeTask("wh-small", "WhatsApp", DAY_MS, 1),
      makeTask("wh-big", "WhatsApp", DAY_MS, 100)
    ];

    const order = await dispatchAndRecord(tasks);

    // equal lastEngagementAt -> larger record count first
    expect(order.get("WhatsApp")).toEqual(["wh-big", "wh-small"]);
  });
});

describe("dispatchTasksToMessageApps — non-WhatsApp ordering unchanged", () => {
  it("orders Telegram users by record count (largest first), ignoring window edge", async () => {
    const tasks = [
      makeTask("tg-edge-small", "Telegram", DAY_MS, 1), // nearest edge but smallest
      makeTask("tg-big", "Telegram", 1 * 60 * 60 * 1000, 100),
      makeTask("tg-mid", "Telegram", 2 * 60 * 60 * 1000, 50)
    ];

    const order = await dispatchAndRecord(tasks);

    expect(order.get("Telegram")).toEqual([
      "tg-big",
      "tg-mid",
      "tg-edge-small"
    ]);
  });

  it("keeps each app's ordering independent when apps are mixed", async () => {
    const tasks = [
      makeTask("wh-fresh", "WhatsApp", 1 * 60 * 60 * 1000, 100),
      makeTask("wh-edge", "WhatsApp", DAY_MS, 1),
      makeTask("tg-small", "Telegram", DAY_MS, 1),
      makeTask("tg-big", "Telegram", 1 * 60 * 60 * 1000, 100)
    ];

    const order = await dispatchAndRecord(tasks);

    expect(order.get("WhatsApp")).toEqual(["wh-edge", "wh-fresh"]); // edge-first
    expect(order.get("Telegram")).toEqual(["tg-big", "tg-small"]); // record-count
  });
});
