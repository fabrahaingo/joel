import axios from "axios";

export const log = async (args: { event: UmamiEvent; data?: any }) => {
  if (process.env.NODE_ENV === "development") {
    console.log("Umami event", args.event);
    return;
  }

  const endpoint = `https://${process.env.UMAMI_HOST}/api/send`;
  const payload = {
    payload: {
      hostname: process.env.UMAMI_HOST,
      website: process.env.UMAMI_ID,
      name: args.event,
      data: args.data,
    },
    type: "event",
  };
  const options = {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0",
    },
  };

  await axios.post(endpoint, payload, options);
};

export default {
  log,
};

export type UmamiEvent =
    | "/new-user"
    | "/user-deletion-no-follow"
    | "/user-deletion-command"
    | "/user-deletion"
    | "/start"
    | "/default-message"
    | "/help"
    | "/stats"
    | "/list"
    | "/delete-account"
    | "/jorfsearch-request-people"
    | "/jorfsearch-request-people-formatted"
    | "/jorfsearch-request-tag"
    | "/jorfsearch-request-organisation"
    | "/jorfsearch-request-date"
    | "/search"
    | "/history"
    | "/follow"
    | "/ena"
    | "/follow-function"
    | "/unfollow"
    | "/user-blocked-joel"
    | "/user-deletion-self"
    | "/notification-update"
    | "/person-updated"
    | "/person-added"
    | "/daily-active-user"


