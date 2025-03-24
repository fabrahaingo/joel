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
    | "/start"
    | "/default-message"
    | "/help"
    | "/stats"
    | "/list"
    | "/jorfsearch-request-people"
    | "/jorfsearch-request-tag"
    | "/jorfsearch-request-organisation"
    | "/jorfsearch-request-date"
    | "/search"
    | "/follow"
    | "/ena"
    | "/follow-function"
    | "/unfollow"
    | "/user-blocked-joel"
    | "/notification-functions"
    | "/notification-people"
    | "/person-updated"
    | "/person-added"
    | "/autom-update-people-start"
    | "/autom-update-people-end"
    | "/autom-update-functions-start"
    | "/autom-update-functions-end"
    | "/autom-notify-start"
    | "/autom-notify-end"

