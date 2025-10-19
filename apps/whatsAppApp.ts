import "dotenv/config";

import express from "express";
import type { Server } from "http";

let server: Server | null = null;
let shuttingDown = false;

import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { PostData, ServerMessage } from "whatsapp-api-js/types";

import { mongodbConnect } from "../db.ts";
import umami from "../utils/umami.ts";
import {
  WHATSAPP_API_VERSION,
  WhatsAppSession
} from "../entities/WhatsAppSession.ts";
import { processMessage } from "../commands/Commands.ts";
import { startDailyNotificationJob } from "../notifications/notificationScheduler.ts";

const MAX_AGE_SEC = 5 * 60;

const {
  WHATSAPP_USER_TOKEN,
  WHATSAPP_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_APP_PORT,
  WHATSAPP_PHONE_ID
} = process.env;

export function getWhatsAppAPI(): WhatsAppAPI {
  if (
    WHATSAPP_USER_TOKEN === undefined ||
    WHATSAPP_APP_SECRET === undefined ||
    WHATSAPP_PHONE_ID === undefined
  ) {
    console.log("Shutting down JOEL WhatsApp bot... \u{1F6A9}");
    process.exit(0);
  }

  return new WhatsAppAPI({
    token: WHATSAPP_USER_TOKEN,
    appSecret: WHATSAPP_APP_SECRET,
    webhookVerifyToken: WHATSAPP_VERIFY_TOKEN,
    v: WHATSAPP_API_VERSION
  });
}

const whatsAppAPI = getWhatsAppAPI();

// Define a custom interface to add rawBody property
interface ExtendedRequest extends express.Request {
  rawBody?: Buffer;
}

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as ExtendedRequest).rawBody = buf;
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
      await umami.log("/message-received-echo-refused", "WhatsApp");
      return;
    }
  }

  try {
    const signature = req.header("x-hub-signature-256");
    if (!signature) {
      res.sendStatus(401); // Unauthorised if the signature is missing
      return;
    }

    const rawPayload = (
      (req as ExtendedRequest).rawBody ?? Buffer.from(JSON.stringify(postData))
    ).toString("utf8");
    await whatsAppAPI.post(postData, rawPayload, signature);

    res.sendStatus(200);
  } catch (error) {
    res.sendStatus(500);
    console.log(error);
  }
});

app.get("/", (req, res) => {
  res.type("text/plain").send("JOEL WH server is running.");
});

app.get("/webhook", (req, res) => {
  try {
    const {
      "hub.mode": mode,
      "hub.verify_token": verifyToken,
      "hub.challenge": challenge
    } = req.query as Record<string, string | undefined>;

    if (
      mode === undefined &&
      verifyToken === undefined &&
      challenge === undefined
    ) {
      res.type("text/plain").send("JOEL WhatsApp webhook is reachable.");
      return;
    }

    const challengeNumber = challenge ? parseInt(challenge) : NaN;
    if (challenge === undefined || isNaN(challengeNumber)) {
      res.status(403).send("Forbidden");
      return;
    }

    if (mode === "subscribe") {
      if (
        typeof verifyToken === "string" &&
        verifyToken === WHATSAPP_VERIFY_TOKEN
      ) {
        console.log("WhatsApp : Successful webhook verification");
        res.send(challenge);
        return;
      } else {
        res.status(403).send("Forbidden");
        return;
      }
    }
    res.sendStatus(400);
  } catch (e: unknown) {
    res.sendStatus(e as number);
    console.log(e);
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

const warnedPhoneIDs = new Set<string>();

whatsAppAPI.on.message = async ({ phoneID, from, message }) => {
  // Ignore echoes of messages the bot just sent
  if (from === WHATSAPP_PHONE_ID) return;
  if (message.type !== "text" && message.type !== "interactive") return;

  const msgText = textFromMessage(message);

  if (phoneID !== WHATSAPP_PHONE_ID) {
    if (!warnedPhoneIDs.has(phoneID)) {
      warnedPhoneIDs.add(phoneID);
      console.warn(
        `WhatsApp: first inbound from non-primary phoneID ${phoneID} (expected ${WHATSAPP_PHONE_ID ?? ""}). Ignoring from now on.`
      );
    }
    return;
  }
  if (msgText == null) return;

  try {
    await umami.log("/message-received", "WhatsApp");

    await whatsAppAPI.markAsRead(phoneID, message.id);

    const WHSession = new WhatsAppSession(whatsAppAPI, phoneID, from, "fr");
    await WHSession.loadUser();

    if (WHSession.user != null) await WHSession.user.updateInteractionMetrics();

    await processMessage(WHSession, msgText);
  } catch (error) {
    console.log(error);
  }
  return;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
whatsAppAPI.on.sent = ({ phoneID, to }) => {
  //console.log(`Bot ${phoneID} sent to user ${to} ${String(to)}`);
};

installSignalHandlers();

server = app.listen(WHATSAPP_APP_PORT, function () {
  //console.log(`Example WhatsApp listening at ${String(WHATSAPP_APP_PORT)}`);
});

await (async function () {
  await mongodbConnect();

  console.log(`WhatsApp: JOEL started successfully \u{2705}`);

  startDailyNotificationJob("WhatsApp");
})();

// Define an interface for the potential message-containing object
interface WhatsAppValueObject {
  messages?: { timestamp?: string }[];
  statuses?: { timestamp?: string }[];
  message_statuses?: { timestamp?: string }[];
  [key: string]: unknown;
}

function newestTimestampSec(data: PostData): number | null {
  let newest: number | null = null;
  for (const e of data.entry) {
    for (const c of e.changes) {
      const v = c.value as WhatsAppValueObject;
      const buckets = [v.messages, v.statuses, v.message_statuses];
      for (const arr of buckets) {
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          const ts = Number(item.timestamp);
          if (Number.isFinite(ts))
            newest = newest === null ? ts : Math.max(newest, ts);
        }
      }
    }
  }
  return newest;
}

async function gracefulShutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    if (server)
      await new Promise<void>((r) =>
        server.close(() => {
          r();
        })
      );
  } catch {
    /* empty */
  }

  console.log(`WhatsApp: Graceful shutdown complete with code ${code}`);
  process.exit(code);
}

function installSignalHandlers() {
  const handler = (sig: NodeJS.Signals) => () => gracefulShutdown(0);
  ["SIGINT", "SIGTERM", "SIGQUIT", "SIGHUP"].forEach((s) =>
    process.on(s as NodeJS.Signals, handler(s as NodeJS.Signals))
  );

  process.on("uncaughtException", async (err) => {
    console.error(err);
    await gracefulShutdown(1);
  });
  process.on("unhandledRejection", async (reason) => {
    console.error(reason);
    await gracefulShutdown(1);
  });

  // Nodemon restarts
  process.once("SIGUSR2", async () => {
    await gracefulShutdown(0);
    process.kill(process.pid, "SIGUSR2");
  });
}
