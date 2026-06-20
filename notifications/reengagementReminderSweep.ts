import "dotenv/config";
import User from "../models/User.ts";
import { IUser } from "../types.ts";
import {
  ExtendedMiniUserInfo,
  ExternalMessageOptions
} from "../entities/Session.ts";
import {
  MAX_REENGAGEMENT_REMINDERS,
  REENGAGEMENT_REMINDER_INTERVAL_MS,
  sendWhatsAppTemplate,
  WHATSAPP_API_SENDING_CONCURRENCY
} from "../entities/WhatsAppSession.ts";
import { logError } from "../utils/debugLogger.ts";
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
      waitingReengagement: 1
    }
  ).lean();

  if (dueUsers.length === 0) return;

  console.log(
    `Re-engagement reminder sweep: ${String(dueUsers.length)} WhatsApp user(s) due.`
  );

  const limit = pLimit(WHATSAPP_API_SENDING_CONCURRENCY);

  await Promise.all(
    dueUsers.map((user) =>
      limit(async () => {
        const userInfo: ExtendedMiniUserInfo = {
          messageApp: "WhatsApp",
          chatId: user.chatId,
          roomId: user.roomId,
          status: user.status,
          hasAccount: true,
          waitingReengagement: user.waitingReengagement,
          lastEngagementAt: user.lastEngagementAt
        };

        // sendWhatsAppTemplate stamps lastReengagementSentAt and increments
        // reengagementReminderCount on success (see WhatsAppSession.ts).
        const sent = await sendWhatsAppTemplate(
          whatsAppAPI,
          userInfo,
          "meta",
          messageAppsOptions
        );
        if (!sent) {
          await logError(
            "WhatsApp",
            `Re-engagement reminder template failed for user ${user._id.toString()}`
          );
        }
      })
    )
  );
}
