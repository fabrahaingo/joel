import "dotenv/config";

import express from "express";

import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { PostData, ServerMessage } from "whatsapp-api-js/types";

import { mongodbConnect } from "../db.ts";
import umami from "../utils/umami.ts";
import {
  handleWhatsAppAPIErrors,
  WHATSAPP_API_VERSION,
  WhatsAppSession
} from "../entities/WhatsAppSession.ts";
import { startDailyNotificationJobs } from "../notifications/notificationScheduler.ts";
import { logError, sendTelegramDebugMessage } from "../utils/debugLogger.ts";
import { handleIncomingMessage } from "../utils/messageWorkflow.ts";
import { getCachedStats } from "../commands/stats.ts";

const MAX_AGE_SEC = 5 * 60;
const DUPLICATE_MESSAGE_TTL_MS = MAX_AGE_SEC * 1000;

const processedMessageIds = new Map<string, number>();

function rememberInboundMessage(id: string | undefined): boolean {
  if (id == null) return false;

  const now = Date.now();

  // prune entries older than the TTL to avoid unbounded growth
  for (const [knownId, timestamp] of Array.from(processedMessageIds)) {
    if (now - timestamp > DUPLICATE_MESSAGE_TTL_MS) {
      processedMessageIds.delete(knownId);
    }
  }

  if (processedMessageIds.has(id)) {
    return true;
  }

  processedMessageIds.set(id, now);
  return false;
}

const {
  WHATSAPP_USER_TOKEN,
  WHATSAPP_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_APP_PORT,
  WHATSAPP_PHONE_NUMBER,
  WHATSAPP_PHONE_ID
} = process.env;

export function getWhatsAppAPI(): WhatsAppAPI {
  if (
    WHATSAPP_USER_TOKEN === undefined ||
    WHATSAPP_APP_SECRET === undefined ||
    WHATSAPP_PHONE_NUMBER === undefined
  ) {
    console.log("WhatsApp: env is not set, bot did not start \u{1F6A9}");
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

const incomingMessageTargets = new Set<string>();

app.post("/webhook", async (req, res) => {
  const postData = req.body as PostData;

  try {
    const signature = req.header("x-hub-signature-256");
    if (!signature) {
      if (process.env.ALLOW_UNSIGNED_WEBHOOKS) {
        console.log(
          "WhatsApp: Missing signature on incoming webhook (allowed in development)"
        );
        res.sendStatus(200);
        return;
      }
      res.sendStatus(401); // Unauthorised if the signature is missing
      return;
    }

    const incomingData = getBaseIncomingData(postData);

    if (incomingData.emissionTimestamp == null) {
      await logError("WhatsApp", "Received event with null timestamp");
      return;
    }
    if (incomingData.apiPhoneId == null) {
      await logError("WhatsApp", "Received message with null target phone id");
      return;
    }
    if (incomingData.apiPhoneNumber == null) {
      await logError(
        "WhatsApp",
        "Received message with null target phone number"
      );
      return;
    }

    if (incomingData.apiPhoneNumber !== WHATSAPP_PHONE_NUMBER) {
      if (incomingMessageTargets.has(incomingData.apiPhoneNumber)) return;
      const logText = `Received incoming WH webhook event for non-production phone number ${incomingData.apiPhoneNumber} and id ${incomingData.apiPhoneId}. Future events will be ignored.`;
      console.log(logText);
      await sendTelegramDebugMessage(logText);
      incomingMessageTargets.add(incomingData.apiPhoneNumber);
      return;
    } else if (WHATSAPP_PHONE_ID !== incomingData.apiPhoneId) {
      await logError(
        "WhatsApp",
        `WHATSAPP_PHONE_ID should be ${incomingData.apiPhoneId}, it is currently ${WHATSAPP_PHONE_ID ? `"${WHATSAPP_PHONE_ID}"` : "not set"}.`
      );
    }

    const rawPayload = (
      (req as ExtendedRequest).rawBody ?? Buffer.from(JSON.stringify(postData))
    ).toString("utf8");
    await whatsAppAPI.post(postData, rawPayload, signature);

    res.sendStatus(200);
  } catch (error) {
    if (process.env.ALLOW_UNSIGNED_WEBHOOKS) {
      const err = error as { name?: string; message?: string };
      if (
        err.name === "WhatsAppAPIError" &&
        err.message === "Signature doesn't match"
      ) {
        // Silent signature errors in development
        res.sendStatus(200);
        return;
      }
    }
    res.sendStatus(500);
    await logError("WhatsApp", "Webhook processing failed", error);
  }
});

app.get("/", (req, res) => {
  res.type("text/plain").send("JOEL WH server is running.");
});

const CORS_URL = "https://www.joel-officiel.fr";

app.options("/stats/", (req, res) => {
  res.header("Access-Control-Allow-Origin", CORS_URL);
  res.header("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});

app.get("/stats/", async (_req, res) => {
  res.header("Access-Control-Allow-Origin", CORS_URL);
  try {
    const stats = await getCachedStats();
    res.json(stats);
  } catch (error) {
    await logError("WhatsApp", "Failed to serve /stats endpoint", error);
    res.sendStatus(500);
  }
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
    logError("WhatsApp", "Webhook verification failed", e).catch(
      (err: unknown) => {
        console.error("Error logging failed:", err);
      }
    );
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
      void logError("WhatsApp", `Unsupported message type: ${msg.type}`);
      return null;
  }
}

whatsAppAPI.on.message = async ({ phoneID, from, message }) => {
  // Filter out events from the bot itself
  if (from === WHATSAPP_PHONE_ID) return;

  // Filter out non-text messages
  const msgText = textFromMessage(message);
  if (msgText == null) return; // if no text in the message

  // Filter out echo messages
  if (rememberInboundMessage(message.id)) {
    await umami.logAsync({
      event: "/message-received-echo-refused",
      messageApp: "WhatsApp"
    });
    return;
  }

  // Filter out messages older than 5 mins
  const messageTimeStampSeconds = Number(message.timestamp);
  if (!Number.isFinite(messageTimeStampSeconds)) {
    await logError(
      "WhatsApp",
      `Received message with invalid timestamp ${message.timestamp}`
    );
    return;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - messageTimeStampSeconds > MAX_AGE_SEC) {
    await umami.logAsync({
      event: "/message-received-echo-refused",
      messageApp: "WhatsApp"
    });
    return;
  }

  try {
    await whatsAppAPI.markAsRead(phoneID, message.id);

    const messageSentDate = new Date(messageTimeStampSeconds * 1000);

    const WHSession = new WhatsAppSession(
      whatsAppAPI,
      phoneID,
      from,
      "fr",
      messageSentDate
    );
    await handleIncomingMessage(WHSession, msgText, {
      errorContext: "Error processing inbound message"
    });
  } catch (error) {
    await logError("WhatsApp", "Error processing inbound message", error);
  }
  return;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
whatsAppAPI.on.sent = ({ phoneID, to }) => {
  //console.log(`Bot ${phoneID} sent to user ${to} ${String(to)}`);
};

whatsAppAPI.on.status = async ({ id, phone, status, error }) => {
  // Wait for current db operations from message sending workflows to be over before processing the issue
  await new Promise((resolve) => setTimeout(resolve, 5 * 1000));
  const umamiLogger = umami.logAsync;
  if (error) {
    void handleWhatsAppAPIErrors(
      { errorCode: error.code, rawError: error },
      "whatsAppAPI.on.status error",
      phone,
      umamiLogger
    );
    return;
  }
  if (!["sent", "delivered", "read"].some((m) => status === m)) {
    void logError("WhatsApp", `Message ${id} to ${phone} is "${status}"`);
    return;
  }
};

app.listen(WHATSAPP_APP_PORT, function () {
  //console.log(`Example WhatsApp listening at ${String(WHATSAPP_APP_PORT)}`);
});

await (async function () {
  await mongodbConnect();

  if (process.env.NODE_ENV === "development") {
    const {
      NGROK_AUTH_TOKEN,
      NGROK_DEV_HOOK,
      NGROK_API_KEY,
      WHATSAPP_APP_PORT
    } = process.env;

    if (
      NGROK_AUTH_TOKEN == null ||
      NGROK_DEV_HOOK == null ||
      NGROK_API_KEY == null
    ) {
      throw new Error(
        "NGROK_AUTH_TOKEN, NGROK_DEV_HOOK and NGROK_API_KEY must be set in development mode"
      );
    }

    const { connect } = await import("ngrok");

    console.log("WhatsApp: Initializing Ngrok tunnel...");
    const ngrokUrl = await connect({
      proto: "http",
      authtoken: NGROK_AUTH_TOKEN,
      hostname: NGROK_DEV_HOOK,
      addr: WHATSAPP_APP_PORT
    });

    console.log(`WhatsApp: Listening on url ${ngrokUrl}`);
    console.log("WhatsApp: Ngrok tunnel initialized!");
  }

  startDailyNotificationJobs(["WhatsApp"], { whatsAppAPI: whatsAppAPI });
  console.log(`WhatsApp: JOEL started successfully \u{2705}`);
})();

// Define an interface for the potential message-containing object
interface WhatsAppValueObject {
  messages?: { timestamp?: string }[];
  statuses?: { timestamp?: string }[];
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  message_statuses?: { timestamp?: string }[];
  [key: string]: unknown;
}

function getBaseIncomingData(data: PostData): {
  apiPhoneNumber: string | null;
  apiPhoneId: string | null;
  emissionTimestamp: number | null;
} {
  let newest: number | null = null;
  let apiPhoneId: string | null = null;
  let apiPhoneNumber: string | null = null;
  for (const e of data.entry) {
    for (const c of e.changes) {
      const v = c.value as WhatsAppValueObject;
      apiPhoneNumber ??= v.metadata?.display_phone_number ?? null;
      apiPhoneId ??= v.metadata?.phone_number_id ?? null;
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
    if (data.entry.length > 1) {
      void logError(
        "WhatsApp",
        `Received webhook with multiple changes (${String(e.changes.length)}); only the first is processed.`
      );
    }
  }
  if (data.entry.length > 1) {
    void logError(
      "WhatsApp",
      `Received webhook with multiple entries (${String(data.entry.length)}); only the first is processed.`
    );
  }
  return { apiPhoneId, apiPhoneNumber, emissionTimestamp: newest };
}
