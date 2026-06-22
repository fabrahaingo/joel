import "dotenv/config";
import User, { MAX_PENDING_AGE_MS } from "../models/User.ts";
import { IUser } from "../types.ts";
import type { QueryFilter } from "mongoose";
import {
  ExtendedMiniUserInfo,
  ExternalMessageOptions
} from "../entities/Session.ts";
import {
  FINAL_NOTIFICATION_TEMPLATE,
  MAX_REENGAGEMENT_REMINDERS,
  NOTIFICATION_TEMPLATE,
  REENGAGEMENT_MAX_SENDS_PER_SWEEP,
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
  const pendingAgeCutoff = new Date(Date.now() - MAX_PENDING_AGE_MS);

  // A user has "live" pending only if at least one batch holds real, current
  // records: non-empty source_ids AND either an exempt type (people/name, never
  // aged out) or recent enough that the capped age-out hasn't dropped it. Gating
  // on mere array presence let legacy users sitting on empty/stale pending qualify
  // forever, which blasted the whole backlog on the first sweep.
  const livePendingClause: QueryFilter<IUser> = {
    pendingNotifications: {
      $elemMatch: {
        "source_ids.0": { $exists: true },
        $or: [
          { notificationType: { $in: ["people", "name"] } },
          { insertDate: { $gte: pendingAgeCutoff } }
        ]
      }
    }
  };

  // Self-heal: drain the legacy backlog without a migration. Any user still
  // flagged waiting but with no live pending (empty or fully stale) can never be
  // legitimately reminded, so clear the flag/cycle so it stops matching future
  // sweeps and never fires a false reminder.
  const healed = await User.updateMany(
    {
      messageApp: "WhatsApp",
      waitingReengagement: true,
      $nor: [livePendingClause]
    },
    { $set: { waitingReengagement: false, reengagementReminderCount: 0 } }
  );
  if (healed.modifiedCount > 0) {
    console.log(
      `Re-engagement reminder sweep: cleared ${String(healed.modifiedCount)} stale waiting flag(s).`
    );
  }

  const dueFilter: QueryFilter<IUser> = {
    messageApp: "WhatsApp",
    status: "active",
    waitingReengagement: true,
    ...livePendingClause,
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
  };

  const dueCount = await User.countDocuments(dueFilter);
  if (dueCount === 0) return;

  // Cap sends per run and serve least-recently-reminded first (missing
  // lastReengagementSentAt sorts first), so a large backlog is staggered across
  // daily sweeps instead of blasted at once. Overflow rolls over to the next run.
  const dueUsers: IUser[] = await User.find(dueFilter, {
    chatId: 1,
    roomId: 1,
    status: 1,
    lastEngagementAt: 1,
    waitingReengagement: 1,
    reengagementReminderCount: 1
  })
    .sort({ lastReengagementSentAt: 1 })
    .limit(REENGAGEMENT_MAX_SENDS_PER_SWEEP)
    .lean();

  const deferred = dueCount - dueUsers.length;
  console.log(
    `Re-engagement reminder sweep: ${String(dueUsers.length)} WhatsApp user(s) due` +
      (deferred > 0
        ? `, ${String(deferred)} deferred to next sweep (cap ${String(REENGAGEMENT_MAX_SENDS_PER_SWEEP)}).`
        : ".")
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
