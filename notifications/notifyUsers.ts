import "dotenv/config";
import { mongodbConnect } from "../db.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { MessageApp } from "../types.ts";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { ErrorMessages } from "../entities/ErrorMessages.ts";
import { WHATSAPP_API_VERSION } from "../entities/WhatsAppSession.ts";
import { SignalCli } from "signal-sdk";
import { ExternalMessageOptions } from "../entities/Session.ts";
import { JORFtoDate } from "../utils/date.utils.ts";
import { callJORFSearchDay } from "../utils/JORFSearch.utils.ts";
import { notifyOrganisationsUpdates } from "./organisationNotifications.ts";
import { notifyPeopleUpdates } from "./peopleNotifications.ts";
import { notifyNameMentionUpdates } from "./nameNotifications.ts";
import { notifyFunctionTagsUpdates } from "./functionTagNotifications.ts";
import umami from "../utils/umami.ts";

const SHIFT_DAYS = 30;

const { ENABLED_APPS } = process.env;
if (ENABLED_APPS === undefined) throw new Error("ENABLED_APPS env var not set");
const enabledApps = JSON.parse(ENABLED_APPS) as MessageApp[];

const invalidApps: string[] = [];
for (const app of enabledApps) {
  if (!["Telegram", "Matrix", "WhatsApp", "Signal"].includes(app))
    invalidApps.push(app);
}
if (invalidApps.length > 0)
  throw new Error(
    `Invalid message app${invalidApps.length > 0 ? "s" : ""}: ${invalidApps.join(", ")}`
  );

let whatsAppAPI: WhatsAppAPI | undefined = undefined;
if (enabledApps.includes("WhatsApp")) {
  const { WHATSAPP_USER_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN } =
    process.env;
  if (
    WHATSAPP_USER_TOKEN === undefined ||
    WHATSAPP_APP_SECRET === undefined ||
    WHATSAPP_VERIFY_TOKEN === undefined
  )
    throw new Error(ErrorMessages.WHATSAPP_ENV_NOT_SET);

  whatsAppAPI = new WhatsAppAPI({
    token: WHATSAPP_USER_TOKEN,
    appSecret: WHATSAPP_APP_SECRET,
    webhookVerifyToken: WHATSAPP_VERIFY_TOKEN,
    v: WHATSAPP_API_VERSION
  });
}

let signalCli: SignalCli | undefined = undefined;
if (enabledApps.includes("Signal")) {
  const { SIGNAL_BAT_PATH, SIGNAL_PHONE_NUMBER } = process.env;
  if (SIGNAL_BAT_PATH === undefined || SIGNAL_PHONE_NUMBER === undefined)
    throw new Error(ErrorMessages.SIGNAL_ENV_NOT_SET);

  signalCli = new SignalCli(SIGNAL_BAT_PATH, SIGNAL_PHONE_NUMBER);
  await signalCli.connect();
}

const messageAppsOptions: ExternalMessageOptions = {
  signalCli,
  whatsAppAPI
};

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

  const results: JORFSearchItem[][] = [];
  for (const sub of chunks) {
    results.push(...(await Promise.all(sub.map(callJORFSearchDay))));
  }

  return results
    .flat()
    .sort(
      (a, b) =>
        JORFtoDate(a.source_date).getTime() -
        JORFtoDate(b.source_date).getTime()
    );
}

await (async () => {
  await mongodbConnect();

  const currentDate = new Date();
  const startDate = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate() - SHIFT_DAYS
  );
  startDate.setHours(0, 0, 0, 0);

  const JORFAllRecordsFromDate = await getJORFRecordsFromDate(startDate);

  if (JORFAllRecordsFromDate.length > 0) {
    await notifyPeopleUpdates(
      JORFAllRecordsFromDate,
      enabledApps,
      messageAppsOptions
    );

    await notifyNameMentionUpdates(
      JORFAllRecordsFromDate,
      enabledApps,
      messageAppsOptions
    );

    await notifyFunctionTagsUpdates(
      JORFAllRecordsFromDate,
      enabledApps,
      messageAppsOptions
    );

    await notifyOrganisationsUpdates(
      JORFAllRecordsFromDate,
      enabledApps,
      messageAppsOptions
    );
  }

  await umami.log({ event: "/notification-process-completed" });

  process.exit(0);
})();
