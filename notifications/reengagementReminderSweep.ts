import "dotenv/config";
import User from "../models/User.ts";
import { IUser } from "../types.ts";
import {
  ExtendedMiniUserInfo,
  ExternalMessageOptions
} from "../entities/Session.ts";
import {
  FINAL_NOTIFICATION_TEMPLATE,
  MAX_REENGAGEMENT_REMINDERS,
  NOTIFICATION_TEMPLATE,
  REENGAGEMENT_REMINDER_INTERVAL_MS,
  sendWhatsAppTemplate,
  TEMPLATE_MESSAGE_COST_EUROS,
  WHATSAPP_API_SENDING_CONCURRENCY
} from "../entities/WhatsAppSession.ts";
import { logError } from "../utils/debugLogger.ts";
import umami from "../utils/umami.ts";
import pLimit from "p-limit";

/**
 * Weekly re-engagement reminder sweep for WhatsApp users with pending
 * notifications. Resends the re-engagement template (reopening the 24h window)
 * to users who haven't engaged, at most once per REENGAGEMENT_REMINDER_INTERVAL_MS,
 * and at most MAX_REENGAGEMENT_REMINDERS times per pending cycle.
 *
 * The reminder count is per pending cycle: it starts at 0 (reset on re-engagement
 * in triggerPendingNotifications), so legacy pending users get a fresh cycle from
 * the moment this feature ships.
 */
export async function runReengagementReminderSweep(
  messageAppsOptions: ExternalMessageOptions
): Promise<void> {
  const whatsAppAPI = messageAppsOptions.whatsAppAPI;
  if (whatsAppAPI == null) {
    await logError(
      "WhatsApp",
      "runReengagementReminderSweep skipped: WhatsApp client is not set"
    );
    return;
  }

  const reminderCutoff = new Date(
    Date.now() - REENGAGEMENT_REMINDER_INTERVAL_MS
  );

  const dueUsers: IUser[] = await User.find(
    {
      messageApp: "WhatsApp",
      status: "active",
      waitingReengagement: true,
      "pendingNotifications.0": { $exists: true },
      $and: [
        {
          $or: [
            { reengagementReminderCount: { $exists: false } },
            { reengagementReminderCount: { $lt: MAX_REENGAGEMENT_REMINDERS } }
          ]
        },
        {
          $or: [
            { lastReengagementSentAt: { $exists: false } },
            { lastReengagementSentAt: { $lte: reminderCutoff } }
          ]
        }
      ]
    },
    {
      chatId: 1,
      roomId: 1,
      status: 1,
      lastEngagementAt: 1,
      waitingReengagement: 1,
      reengagementReminderCount: 1
    }
  ).lean();

  if (dueUsers.length === 0) return;

  console.log(
    `Re-engagement reminder sweep: ${String(dueUsers.length)} WhatsApp user(s) due.`
  );

  const limit = pLimit(WHATSAPP_API_SENDING_CONCURRENCY);

  let sentCount = 0;
  let failedCount = 0;

  await Promise.all(
    dueUsers.map((user) =>
      limit(async () => {
        try {
          const userInfo: ExtendedMiniUserInfo = {
            messageApp: "WhatsApp",
            chatId: user.chatId,
            roomId: user.roomId,
            status: user.status,
            hasAccount: true,
            waitingReengagement: user.waitingReengagement,
            lastEngagementAt: user.lastEngagementAt
          };

          // Last allowed nudge uses the distinct "final" template so the user
          // knows it's the last one before the bot goes quiet.
          const isFinalReminder =
            (user.reengagementReminderCount ?? 0) + 1 >=
            MAX_REENGAGEMENT_REMINDERS;
          const templateName = isFinalReminder
            ? FINAL_NOTIFICATION_TEMPLATE
            : NOTIFICATION_TEMPLATE;

          // sendWhatsAppTemplate stamps lastReengagementSentAt and increments
          // reengagementReminderCount on success (see WhatsAppSession.ts).
          const sent = await sendWhatsAppTemplate(
            whatsAppAPI,
            userInfo,
            "meta",
            messageAppsOptions,
            templateName
          );
          if (sent) {
            sentCount++;
          } else {
            failedCount++;
            await logError(
              "WhatsApp",
              `Re-engagement reminder template failed for user ${user._id.toString()}`
            );
          }
        } catch (error) {
          // Isolate failures so one bad send doesn't abort the whole sweep.
          failedCount++;
          await logError(
            "WhatsApp",
            `Re-engagement reminder threw for user ${user._id.toString()}`,
            error
          );
        }
      })
    )
  );

  const totalCost = sentCount * TEMPLATE_MESSAGE_COST_EUROS;
  console.log(
    `Re-engagement reminder sweep done: ${String(sentCount)} sent, ${String(failedCount)} failed, est. cost €${totalCost.toFixed(2)}.`
  );
  await umami.logAsync({
    event: "/reengagement-reminder-sweep",
    messageApp: "WhatsApp",
    hasAccount: true,
    payload: {
      due: dueUsers.length,
      sent: sentCount,
      failed: failedCount,
      cost_eur: totalCost
    }
  });
}
