import "dotenv/config";

import express from "express";

import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { PostData, ServerMessage } from "whatsapp-api-js/types";
import type { OnMessageArgs } from "whatsapp-api-js/emitters";
import { WhatsAppAPIError } from "whatsapp-api-js/errors";

import { mongodbConnect, mongodbDisconnect } from "../db.ts";
import umami from "../utils/umami.ts";
import {
  handleWhatsAppAPIErrors,
  WHATSAPP_API_VERSION,
  WhatsAppSession
} from "../entities/WhatsAppSession.ts";
import { startDailyNotificationJobs } from "../notifications/notificationScheduler.ts";
import {
  logError,
  logWarning,
  sendTelegramDebugMessage
} from "../utils/debugLogger.ts";
import { handleIncomingMessage } from "../utils/messageWorkflow.ts";
import { getCachedStats } from "../commands/stats.ts";
import { createTtlDedup } from "../utils/webhookDedup.ts";
import { textFromMessage } from "../utils/whatsAppMessageText.ts";
import {
  buildHealthReport,
  HEALTH_PATH,
  mongoProbe
} from "../utils/healthServer.ts";
import { isBlankEnv } from "../utils/env.utils.ts";

const MAX_AGE_SEC = 5 * 60;
const DUPLICATE_MESSAGE_TTL_MS = MAX_AGE_SEC * 1000;

const rememberInboundMessage = createTtlDedup(DUPLICATE_MESSAGE_TTL_MS);
// Statuses need their own window: one message id legitimately emits
// sent -> delivered -> read, so the dedup key includes the status/error.
const rememberStatusEvent = createTtlDedup(DUPLICATE_MESSAGE_TTL_MS);

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
    isBlankEnv(WHATSAPP_USER_TOKEN) ||
    isBlankEnv(WHATSAPP_APP_SECRET) ||
    isBlankEnv(WHATSAPP_PHONE_NUMBER)
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

// Define a custom interface to add rawBody property
interface ExtendedRequest extends express.Request {
  rawBody?: Buffer;
}

await (async function () {
  // Register stopper
  let shuttingDown = false;
  try {
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log(`WhatsApp: Received ${signal}, shutting down...`);

      try {
        // Close DB cleanly
        await mongodbDisconnect();

        // Let stdout flush naturally; do not force-exit yet
        process.exitCode = 0;
      } catch (error) {
        await logError("WhatsApp", `Error during ${signal} shutdown`, error);
        process.exitCode = 1;
      }

      // Safety net: if something keeps the event loop alive, force exit.
      setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
    };

    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      process.once(sig, () => {
        void shutdown(sig);
      });
    }

    // Start the bot by connecting to MongoDB
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

      const { forward } = await import("@ngrok/ngrok");

      console.log("WhatsApp: Initializing Ngrok tunnel...");
      const listener = await forward({
        proto: "http",
        authtoken: NGROK_AUTH_TOKEN,
        domain: NGROK_DEV_HOOK,
        addr: WHATSAPP_APP_PORT
      });
      const ngrokUrl = listener.url();
      if (ngrokUrl == null) {
        throw new Error("Ngrok tunnel did not return a public URL");
      }

      console.log(`WhatsApp: Listening on url ${ngrokUrl}`);
      console.log("WhatsApp: Ngrok tunnel initialized!");
    }

    const whatsAppAPI = getWhatsAppAPI();

    const app = express();
    app.use(
      express.json({
        verify: (req, _res, buf) => {
          (req as ExtendedRequest).rawBody = buf;
        }
      })
    );

    // The bot is webhook-driven, so serving this port is itself the proof that
    // it can still receive: the only dependency left to assert is the database.
    const startedAt = Date.now();
    app.get(HEALTH_PATH, (_req, res) => {
      void (async () => {
        const report = await buildHealthReport(
          "WhatsApp",
          { mongo: mongoProbe },
          (Date.now() - startedAt) / 1000
        );
        res.status(report.statusCode).json(report.body);
      })();
    });

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
          await logError(
            "WhatsApp",
            "Received message with null target phone id"
          );
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
          (req as ExtendedRequest).rawBody ??
          Buffer.from(JSON.stringify(postData))
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
        // Meta redelivers on any non-2xx. Reply with the status the library
        // attached to the error (401 on a bad signature, 400 on a malformed
        // payload) so a permanently unprocessable delivery is not retried on a
        // schedule; anything unclassified keeps the retryable 500.
        res.sendStatus(
          error instanceof WhatsAppAPIError ? error.httpStatus : 500
        );
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

    whatsAppAPI.on.message = async (args) => {
      try {
        await handleInboundMessage(whatsAppAPI, args);
      } catch (error) {
        // Never let a handler fault escape into `whatsAppAPI.post()`: it would
        // turn the webhook reply into a 500 and Meta would redeliver the same
        // payload on a schedule, replaying the same fault.
        await logError("WhatsApp", "Error handling inbound message", error);
      }
    };

    const handleInboundMessage = async (
      api: WhatsAppAPI,
      { phoneID, from, message }: OnMessageArgs
    ): Promise<void> => {
      // Filter out events from the bot itself
      if (from === WHATSAPP_PHONE_ID) return;

      // A "messages" change carrying an empty `messages` array reaches the
      // emitter with no message at all, despite the non-optional type.
      if ((message as ServerMessage | undefined) == null) {
        await logWarning("WhatsApp", "Received message event with no message");
        return;
      }

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
        // Mark as read in parallel (don't await)
        void api.markAsRead(phoneID, message.id);

        const messageSentDate = new Date(messageTimeStampSeconds * 1000);

        const WHSession = new WhatsAppSession(
          api,
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
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    whatsAppAPI.on.sent = ({ phoneID, to }) => {
      //console.log(`Bot ${phoneID} sent to user ${to} ${String(to)}`);
    };

    whatsAppAPI.on.status = async ({ id, phone, status, error }) => {
      // Meta delivers statuses at-least-once: drop redeliveries of the same
      // status/error for the same message before doing any work. Distinct
      // statuses for one id (sent -> delivered -> read) pass through.
      if (rememberStatusEvent(`${id}:${String(error?.code ?? status)}`)) return;
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

    startDailyNotificationJobs(["WhatsApp"], { whatsAppAPI: whatsAppAPI });
    console.log(`WhatsApp: JOEL started successfully \u{2705}`);
  } catch (error) {
    await logError("WhatsApp", "Failed to start app", error);
  }
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
