import "dotenv/config";
import { mongodbConnect } from "../db.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { MessageApp } from "../types.ts";
import { JORFtoDate } from "../utils/date.utils.ts";
import { callJORFSearchDay } from "../utils/JORFSearch.utils.ts";
import { notifyOrganisationsUpdates } from "./organisationNotifications.ts";
import { notifyPeopleUpdates } from "./peopleNotifications.ts";
import { notifyNameMentionUpdates } from "./nameNotifications.ts";
import { notifyFunctionTagsUpdates } from "./functionTagNotifications.ts";
import umami from "../utils/umami.ts";
import {
  parseEnabledMessageApps,
  resolveExternalMessageOptions
} from "../utils/messageAppOptions.ts";
import { ExternalMessageOptions } from "../entities/Session.ts";

// Number of days to go back: 0 means we just fetch today's info
const SHIFT_DAYS = 30;

const messageAppOptionsCache = new Map<MessageApp, ExternalMessageOptions>();

async function getJORFRecordsFromDate(
  startDate: Date
): Promise<JORFSearchItem[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);

  const dayCount = (today.getTime() - startDate.getTime()) / 86_400_000 + 1;
  const days: Date[] = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    return d;
  });

  const limit = 8;
  const chunks: Date[][] = [];
  for (let i = 0; i < days.length; i += limit)
    chunks.push(days.slice(i, i + limit));

  const results: (JORFSearchItem[] | null)[] = [];
  for (const sub of chunks) {
    results.push(...(await Promise.all(sub.map(callJORFSearchDay))));
  }

  return results
    .reduce((fullTab: JORFSearchItem[], resDay) => {
      if (resDay == null) throw new Error("JORFSearch returned a null value");

      return fullTab.concat(resDay);
    }, [])
    .sort(
      (a, b) =>
        JORFtoDate(a.source_date).getTime() -
        JORFtoDate(b.source_date).getTime()
    );
}

async function getMessageAppOptions(
  appType: MessageApp
): Promise<ExternalMessageOptions> {
  const cachedOptions = messageAppOptionsCache.get(appType);
  const resolvedOptions = await resolveExternalMessageOptions(
    [appType],
    cachedOptions
  );
  messageAppOptionsCache.set(appType, resolvedOptions);
  return resolvedOptions;
}

export async function runNotificationProcess(
  appType: MessageApp
): Promise<void> {
  const enabledApps = parseEnabledMessageApps();
  if (!enabledApps.includes(appType)) {
    console.warn(
      `Notification process skipped: ${appType} is not enabled in ENABLED_APPS`
    );
    return;
  }

  await mongodbConnect();

  const currentDate = new Date();
  const startDate = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate() - SHIFT_DAYS
  );
  startDate.setHours(0, 0, 0, 0);

  const JORFAllRecordsFromDate = await getJORFRecordsFromDate(startDate);

  const targetApps: MessageApp[] = [appType];
  const messageAppsOptions = await getMessageAppOptions(appType);

  if (JORFAllRecordsFromDate.length > 0) {
    await notifyFunctionTagsUpdates(
      JORFAllRecordsFromDate,
      targetApps,
      messageAppsOptions
    );

    await notifyOrganisationsUpdates(
      JORFAllRecordsFromDate,
      targetApps,
      messageAppsOptions
    );
  }

  await notifyPeopleUpdates(
    JORFAllRecordsFromDate,
    targetApps,
    messageAppsOptions
  );

  await notifyNameMentionUpdates(
    JORFAllRecordsFromDate,
    targetApps,
    messageAppsOptions
  );

  await umami.log("/notification-process-completed", appType);
}
