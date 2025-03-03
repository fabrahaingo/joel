import axios from "axios";
import { ErrorMessages } from "../entities/ErrorMessages";

export const log = async (args: { event: string; data?: never }) => {
  if (process.env.NODE_ENV === "development") {
    console.log("Umami event", args.event);
    return;
  }

  const UMAMI_HOST = process.env.UMAMI_HOST;
  if (!UMAMI_HOST) {
    throw new Error(ErrorMessages.UMAMI_HOST_NOT_SET);
  }

  const endpoint = `https://${UMAMI_HOST}/api/send`;
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
