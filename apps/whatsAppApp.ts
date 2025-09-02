import "dotenv/config";
import ngrok from "ngrok";

import express from "express";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { PostData, ServerMessage } from "whatsapp-api-js/types";

import { ErrorMessages } from "../entities/ErrorMessages.ts";

import { mongodbConnect } from "../db.ts";
import umami from "../utils/umami.ts";
import {
  WHATSAPP_API_VERSION,
  WhatsAppSession
} from "../entities/WhatsAppSession.ts";
import { commands } from "../commands/Commands.ts";

const MAX_AGE_SEC = 5 * 60;

const {
  WHATSAPP_USER_TOKEN,
  WHATSAPP_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_APP_PORT,
  WHATSAPP_PHONE_ID,
  NGROK_AUTH_TOKEN,
  NGROK_DEV_HOOK
} = process.env;

export function getWhatsAppAPI(): WhatsAppAPI {
  if (
    WHATSAPP_USER_TOKEN === undefined ||
    WHATSAPP_APP_SECRET === undefined ||
    WHATSAPP_PHONE_ID === undefined
  ) {
    throw new Error(ErrorMessages.WHATSAPP_ENV_NOT_SET);
  }

  return new WhatsAppAPI({
    token: WHATSAPP_USER_TOKEN,
    appSecret: WHATSAPP_APP_SECRET,
    webhookVerifyToken: WHATSAPP_VERIFY_TOKEN,
    v: WHATSAPP_API_VERSION
  });
}

const whatsAppAPI = getWhatsAppAPI();

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as never).rawBody = buf;
    }
  })
);

app.post("/webhook", async (req, res) => {
  const postData = req.body as PostData;

  // Refuse (ignore) events older than 5 minutes
  const ts = newestTimestampSec(postData);
  if (ts !== null) {
    const now = Math.floor(Date.now() / 1000);
    if (now - ts > MAX_AGE_SEC) {
      // Acknowledge but skip processing so Meta doesn't retry
      res.sendStatus(200);
      await umami.log({ event: "/whatsapp-echo-refused" });
      return;
    }
  }

  try {
    const signature = req.header("x-hub-signature-256");
    if (!signature) {
      res.sendStatus(401); // Unauthorised if the signature is missing
      return;
    }

    // Inverted compared to documentation
    await whatsAppAPI.post(postData, JSON.stringify(postData), signature);

    res.sendStatus(200);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.get("/webhook", (req, res) => {
  try {
    res.send(whatsAppAPI.handle_get(req));
  } catch (e: unknown) {
    res.sendStatus(e as number);
  }
});

/**
 * Pick a printable fragment from any WhatsApp inbound message.
 * Returns `null` when there is nothing reasonably textual.
 */
export function textFromMessage(msg: ServerMessage): string | null {
  switch (msg.type) {
    //  Plain text
    case "text":
      return msg.text.body;

    // Quick-reply buttons
    case "button":
      return msg.button.text;

    //  Interactive replies (List, Reply-button, Flow)  */
    case "interactive":
      switch (msg.interactive.type) {
        case "list_reply":
          return msg.interactive.list_reply.title;
        case "button_reply":
          return msg.interactive.button_reply.title;
        /*
        case "nfm_reply": // Flow submission
          return (
            msg.interactive.nfm_reply.body ??
            msg.interactive.nfm_reply.response_json ??
            null);
          */
      }
      return null;

    /*  Catch-all for anything the API marks
           as unsupported or future types  */
    default:
      return null;
  }
}

whatsAppAPI.on.message = async ({ phoneID, from, message }) => {
  // Ignore echoes of messages the bot just sent
  if (from === WHATSAPP_PHONE_ID) return;
  if (message.type !== "text" && message.type !== "interactive") return;

  const msgText = textFromMessage(message)?.trim();

  if (phoneID !== WHATSAPP_PHONE_ID) {
    if (msgText != null)
      console.log(
        `WhatsApp: Message received from non-production number ${phoneID} : ${msgText}`
      );
    return;
  }
  if (msgText == null) return;

  try {
    await umami.log({ event: "/message-whatsapp" });

    await whatsAppAPI.markAsRead(phoneID, message.id);

    const WHSession = new WhatsAppSession(whatsAppAPI, phoneID, from, "fr");
    await WHSession.loadUser();

    if (WHSession.user != null) await WHSession.user.updateInteractionMetrics();

    for (const command of commands) {
      if (command.regex.test(msgText)) {
        await command.action(WHSession, msgText);
        return;
      }
    }
  } catch (error) {
    console.log(error);
  }
  return;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
whatsAppAPI.on.sent = ({ phoneID, to }) => {
  //console.log(`Bot ${phoneID} sent to user ${to} ${String(to)}`);
};

app.listen(WHATSAPP_APP_PORT, function () {
  //console.log(`Example WhatsApp listening at ${String(WHATSAPP_APP_PORT)}`);
});

await (async function () {
  await mongodbConnect();

  console.log("WhatsApp: Initializing Ngrok tunnel...");

  // Initialise ngrok using the auth token and hostname
  const url = await ngrok.connect({
    proto: "http",
    // Your authtoken if you want your hostname to be the same everytime
    authtoken: NGROK_AUTH_TOKEN,
    // Your hostname if you want your hostname to be the same everytime
    hostname: NGROK_DEV_HOOK,
    // Your app port
    addr: WHATSAPP_APP_PORT
    /*
         verify_webhook_provider: "whatsapp",
         verify_webhook_secret: WHATSAPP_VERIFY_TOKEN,
         verify_webhook: WHATSAPP_GRAPH_API_TOKEN
         */
  });

  console.log(`WhatsApp: Listening on url ${url}`);
  console.log("WhatsApp: Ngrok tunnel initialized!");

  console.log(`WhatsApp: JOEL started successfully \u{2705}`);
})();

function newestTimestampSec(data: PostData): number | null {
  let newest: number | null = null;
  for (const e of data.entry) {
    for (const c of e.changes) {
      const v = c.value;
      const buckets = [v.messages, v.statuses, v.message_statuses];
      for (const arr of buckets) {
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          const ts = Number(item?.timestamp);
          if (Number.isFinite(ts))
            newest = newest === null ? ts : Math.max(newest, ts);
        }
      }
    }
  }
  return newest;
}
