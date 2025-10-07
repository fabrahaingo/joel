import axios from "axios";
import { MessageApp } from "../types";

export const log = async (event: UmamiEvent, messageApp?: MessageApp) => {
  if (process.env.NODE_ENV === "development") {
    console.log(
      `Umami event ${messageApp ? " (" + messageApp + ")" : ""}: ${event}`
    );
    return;
  }

  const endpoint = `https://${String(process.env.UMAMI_HOST)}/api/send`;
  const payload = {
    payload: {
      hostname: process.env.UMAMI_HOST,
      website: process.env.UMAMI_ID,
      name: event,
      data: messageApp ? { messageApp: messageApp } : {}
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
  | "/message-received"
  | "/message-sent"
  | "/message-sent-broadcast"
  | "/message-fail-too-many-requests"
  | "/message-fail-too-many-requests-aborted"
  | "/message-received-echo-refused"
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
