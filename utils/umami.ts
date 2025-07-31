import axios from "axios";

export const log = async (args: { event: UmamiEvent; data?: never }) => {
  if (process.env.NODE_ENV === "development") {
    console.log("Umami event", args.event);
    return;
  }

  const endpoint = `https://${String(process.env.UMAMI_HOST)}/api/send`;
  const payload = {
    payload: {
      hostname: process.env.UMAMI_HOST,
      website: process.env.UMAMI_ID,
      name: args.event,
      data: args.data
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
  | "/message-telegram"
  | "/message-whatsapp"
  | "/start"
  | "/default-message"
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
  | "/jorfsearch-request-wikidata-names"
  | "/search"
  | "/history"
  | "/ena"
  | "/ena-list"
  | "/follow"
  | "/follow-name"
  | "/follow-function"
  | "/follow-organisation"
  | "/unfollow"
  | "/new-user"
  | "/new-organisation"
  | "/person-added"
  | "/user-blocked-joel"
  | "/user-unblocked-joel"
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
