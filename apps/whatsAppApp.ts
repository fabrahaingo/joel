import "dotenv/config";

import express from "express";

import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { PostData, ServerMessage } from "whatsapp-api-js/types";

import { mongodbConnect } from "../db.ts";
import umami from "../utils/umami.ts";
import {
  WHATSAPP_API_VERSION,
  WhatsAppSession
} from "../entities/WhatsAppSession.ts";
import { startDailyNotificationJobs } from "../notifications/notificationScheduler.ts";
import User from "../models/User.ts";
import Organisation from "../models/Organisation.ts";
import People from "../models/People.ts";
import { logError } from "../utils/debugLogger.ts";
import { handleIncomingMessage } from "../utils/messageWorkflow.ts";

const MAX_AGE_SEC = 5 * 60;
const DUPLICATE_MESSAGE_TTL_MS = MAX_AGE_SEC * 1000;

const STATS_REFRESH_RATE = 60 * 60 * 1000; // 1 hour

interface StatsResult {
  organisations: number;
  people: number;
  users: Record<string, number>;
}

const processedMessageIds = new Map<string, number>();
let cachedStats: StatsResult | null = null;
let cachedAt = 0;

async function getCachedStats(): Promise<StatsResult> {
  const now = Date.now();
  if (cachedStats !== null && now - cachedAt < STATS_REFRESH_RATE) {
    return cachedStats;
  }

  const [organisations, people, users] = await Promise.all([
    Organisation.countDocuments().exec(),
    People.countDocuments().exec(),
    User.aggregate<{ _id: string; count: number }>([
      {
        $group: {
          _id: "$messageApp",
          count: { $sum: 1 }
        }
      }
    ])
  ]);

  cachedStats = {
    organisations,
    people,
    users: Object.fromEntries(users.map(({ _id, count }) => [_id, count]))
  };
  cachedAt = now;
  return cachedStats;
}

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
  WHATSAPP_PHONE_NUMBER
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
      res.sendStatus(401); // Unauthorized if the signature is missing
      return;
    }

    // Refuse (ignore) events older than 5 minutes
    const incomingData = getBaseIncomingData(postData);

    if (incomingData.emissionTimestamp == null) {
      await logError("WhatsApp", "Received message with null timestamp");
      return;
    }
    if (incomingData.apiPhoneId == null) {
      await logError(
        "WhatsApp",
        "Received message with null target phone number"
      );
      return;
    }
    if (incomingData.apiPhoneNumber == null) {
      await logError("WhatsApp", "Received message with null target phone id");
      return;
    }

    if (incomingData.apiPhoneNumber !== WHATSAPP_PHONE_NUMBER) {
      if (incomingMessageTargets.has(incomingData.apiPhoneNumber)) return;
      console.log(
        `Received incoming webhook event for phone number non-production number ${incomingData.apiPhoneNumber} and id ${incomingData.apiPhoneId}. Future events will be ignored.`
      );
      incomingMessageTargets.add(incomingData.apiPhoneNumber);
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const delay = now - incomingData.emissionTimestamp;
    if (delay > MAX_AGE_SEC) {
      // Acknowledge but skip processing so Meta doesn't retry
      res.sendStatus(200);
      await umami.logAsync({
        event: "/message-received-echo-refused",
        messageApp: "WhatsApp"
      });
      return;
    }

    const rawPayload = (
      (req as ExtendedRequest).rawBody ?? Buffer.from(JSON.stringify(postData))
    ).toString("utf8");
    await whatsAppAPI.post(postData, rawPayload, signature);

    res.sendStatus(200);
  } catch (error) {
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
      return null;
  }
}

whatsAppAPI.on.message = async ({ phoneID, from, message }) => {
  if (message.type !== "text" && message.type !== "interactive") return;

  const msgText = textFromMessage(message);
  if (msgText == null) return;

  if (rememberInboundMessage(message.id)) {
    await umami.logAsync({
      event: "/message-received-echo-refused",
      messageApp: "WhatsApp"
    });
    return;
  }

  try {
    await whatsAppAPI.markAsRead(phoneID, message.id);

    const WHSession = new WhatsAppSession(whatsAppAPI, phoneID, from, "fr");
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

whatsAppAPI.on.status = ({ id, phone, status, error }) => {
  if (error) {
    void logError(
      "WhatsApp",
      `Message ${id} to ${phone} is "${status}"`,
      error
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
  }
  return { apiPhoneId, apiPhoneNumber, emissionTimestamp: newest };
}
