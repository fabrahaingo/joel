import { ISession, JORFReference } from "../types.ts";
import { logError } from "../utils/debugLogger.ts";
import { daysBetweenCalendar } from "../utils/date.utils.ts";
import { notifyAllFollows } from "../notifications/runNotificationProcess.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import pLimit from "p-limit";
import { JORFSearchPublication } from "../entities/JORFSearchResponseMeta.ts";
import { callJORFSearchReference } from "../utils/JORFSearch.utils.ts";
import User from "../models/User.ts";
import { Publication } from "../models/Publication.ts";

const FETCH_CONCURRENCY = 10;

export const triggerPendingNotifications = async (
  session: ISession
): Promise<void> => {
  try {
    if (session.user == null) {
      await logError(
        session.messageApp,
        `No user found during triggerPendingNotifications for app ${session.messageApp} and id ${session.chatId}`,
        new Error("No user found for triggerPendingNotifications")
      );
      await session.sendMessage("Veuillez ajouter un suivi.");
      return;
    }
    if (session.user.pendingNotifications.length == 0) {
      await session.sendMessage("Aucune notification en attente.");
    }

    let source_id_publications: JORFReference[] = [];
    let source_id_items: JORFReference[] = [];

    for (const pendingNotification of session.user.pendingNotifications) {
      if (pendingNotification.notificationType === "meta") {
        source_id_publications = source_id_publications.concat(
          pendingNotification.source_ids
        );
      } else {
        source_id_items = source_id_items.concat(
          pendingNotification.source_ids
        );
      }
    }

    const limit = pLimit(FETCH_CONCURRENCY);
    const itemsOut = new Map<JORFReference, JORFSearchItem[]>(); // keep order

    await Promise.all(
      source_id_items.map((ref) =>
        limit(async () => {
          const res = await callJORFSearchReference(ref, session.messageApp);
          if (res == null) {
            await logError(
              session.messageApp,
              `Error in triggerPendingNotifications fetching item for ref ${ref}`
            );
            return;
          }
          itemsOut.set(ref, res);
        })
      )
    );

    const candidateJORFPublications: JORFSearchPublication[] =
      await Publication.find({ source_id: { $in: source_id_publications } });

    const candidateJORFSearchItems: JORFSearchItem[] = Array.from(
      itemsOut.keys()
    ).reduce((tab: JORFSearchItem[], ref) => {
      const items = itemsOut.get(ref);
      if (items != null) return tab.concat(items);
      return tab;
    }, []);

    await notifyAllFollows(
      candidateJORFSearchItems,
      candidateJORFPublications,
      [session.messageApp],
      session.extractMessageAppsOptions(),
      [session.user._id],
      true
    );

    await User.updateOne(
      { _id: session.user._id },
      { $set: { waitingReengagement: false } }
    );

    const earliestInsertDate = session.user.pendingNotifications.reduce(
      (earliest: Date, notification) => {
        if (notification.insertDate.getTime() < earliest.getTime())
          return notification.insertDate;
        return earliest;
      },
      session.user.pendingNotifications[0].insertDate
    );

    session.log({
      event: "/trigger-pending-updates",
      payload: {
        reengagement_delay_days: daysBetweenCalendar(
          earliestInsertDate,
          new Date()
        ),
        number_batches: session.user.pendingNotifications.length
      }
    });
  } catch (error) {
    await logError(
      session.messageApp,
      "Error in triggerPendingNotifications command",
      error
    );
  }
};
