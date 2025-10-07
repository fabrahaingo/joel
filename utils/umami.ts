import axios from "axios";
import { MessageApp } from "../types";

export interface UmamiNotificationData {
  message_nb: number;
  updated_follows_nb: number;
  total_records_nb: number;
}

export const log = async (
  event: UmamiEvent,
  messageApp?: MessageApp,
  notificationData?: UmamiNotificationData
) => {
  if (process.env.NODE_ENV === "development") {
    console.log(
      `Umami event ${messageApp ? " (" + messageApp + ")" : ""}: ${event}`
    );
    if (notificationData != null) console.log(notificationData);
    return;
  }

  const extra_data: Record<string, unknown> = {};
  if (messageApp) {
    extra_data.messageApp = messageApp;
  }
  if (notificationData != null) {
    extra_data.message_nb = notificationData.message_nb;
    extra_data.updated_follows_nb = notificationData.updated_follows_nb;
    extra_data.total_records_nb = notificationData.total_records_nb;
  }
  const endpoint = `https://${String(process.env.UMAMI_HOST)}/api/send`;
  const payload = {
    payload: {
      hostname: process.env.UMAMI_HOST,
      website: process.env.UMAMI_ID,
      name: event,
      data: extra_data
    },
    type: "event"
  };
  const options = {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0"
    }
  };

  try {
    await axios.post(endpoint, payload, options);
  } catch (error) {
    console.log(error);
  }
};

export default {
  log
};

export type UmamiEvent =
  | "/message-matrix"
  | "/message-signal"
  | "/message-telegram"
  | "/message-whatsapp"
  | "/message-sent-matrix"
  | "/message-sent-signal"
  | "/message-sent-telegram"
  | "/message-sent-whatsapp"
  | "/message-sent-broadcast"
  | "/matrix-too-many-requests"
  | "/matrix-too-many-requests-aborted"
  | "/telegram-too-many-requests"
  | "/telegram-too-many-requests-aborted"
  | "/whatsapp-too-many-requests"
  | "/whatsapp-echo-refused"
  | "/whatsapp-too-many-requests-aborted"
  | "/start"
  | "/start-from-people"
  | "/start-from-organisation"
  | "/start-from-tag"
  | "/default-message"
  | "/main-menu-message"
  | "/help"
  | "/stats"
  | "/list"
  | "/delete-profile"
  | "/jorfsearch-request-people"
  | "/jorfsearch-request-people-formatted"
  | "/jorfsearch-request-tag"
  | "/jorfsearch-request-organisation"
  | "/jorfsearch-request-date"
  | "/jorfsearch-request-meta"
  | "/jorfsearch-request-reference"
  | "/jorfsearch-request-wikidata-names"
  | "/search"
  | "/history"
  | "/ena"
  | "/ena-list"
  | "/follow"
  | "/follow-name"
  | "/follow-function"
  | "/follow-organisation"
  | "/follow-reference"
  | "/unfollow"
  | "/new-user"
  | "/new-organisation"
  | "/person-added"
  | "/user-blocked-joel"
  | "/user-unblocked-joel"
  | "/user-deactivated"
  | "/user-deletion-no-follow"
  | "/user-deletion-self"
  | "/notification-update-people"
  | "/notification-update-name"
  | "/notification-update-function"
  | "/notification-update-organisation"
  | "/notification-update-meta"
  | "/notification-process-completed"
  | "/daily-active-user"
  | "/weekly-active-user"
  | "/monthly-active-user";
