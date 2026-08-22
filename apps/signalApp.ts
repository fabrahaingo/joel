import "dotenv/config";

import { SignalRestClient } from "../utils/signalRestClient.ts";
import { mongodbConnect, mongodbDisconnect } from "../db.ts";
import { SignalSession } from "../entities/SignalSession.ts";
import { startDailyNotificationJobs } from "../notifications/notificationScheduler.ts";
import { logError } from "../utils/debugLogger.ts";
import { handleIncomingMessage } from "../utils/messageWorkflow.ts";
import { mongoProbe, startHealthServer } from "../utils/healthServer.ts";
import { healthPort } from "../utils/healthProbe.ts";
import { isBlankEnv } from "../utils/env.utils.ts";

const { SIGNAL_PHONE_NUMBER, SIGNAL_API_URL } = process.env;

if (isBlankEnv(SIGNAL_PHONE_NUMBER) || isBlankEnv(SIGNAL_API_URL)) {
  console.log("Signal: env is not set, bot did not start \u{1F6A9}");
  process.exit(0);
}

interface ISignalMessage {
  envelope: {
    sourceNumber: string;
    dataMessage?: {
      message?: string;
    };
    receiptMessage?: never;
  };
}
await (async () => {
  let healthServer: ReturnType<typeof startHealthServer> | undefined;
  try {
    // Talks to the signal-cli-rest-api service over HTTP (send) + WebSocket
    // (receive). No local signal-cli process.
    const signalCli = new SignalRestClient(SIGNAL_API_URL, SIGNAL_PHONE_NUMBER);

    // Register stopper
    let shuttingDown = false;

    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log(`Signal: Received ${signal}, shutting down...`);

      try {
        signalCli.disconnect();
        healthServer?.close();

        // Close DB cleanly
        await mongodbDisconnect();

        // Let stdout flush naturally; do not force-exit yet
        process.exitCode = 0;
      } catch (error) {
        await logError("Signal", `Error during ${signal} shutdown`, error);
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

    // Connect to signal-cli daemon
    await signalCli.connect();

    // Listen for incoming messages
    signalCli.on("message", (message: ISignalMessage) => {
      void (async () => {
        try {
          if (message.envelope.sourceNumber === SIGNAL_PHONE_NUMBER) return;

          const msgText = message.envelope.dataMessage?.message;
          if (msgText === undefined) return;

          const messageSentTime = new Date(); // TODO: use the real message timestamp

          const signalSession = new SignalSession(
            signalCli,
            SIGNAL_PHONE_NUMBER,
            message.envelope.sourceNumber,
            "fr",
            messageSentTime
          );

          await handleIncomingMessage(signalSession, msgText, {
            errorContext: "Error processing command"
          });
        } catch (error) {
          await logError("Signal", "Error processing command", error);
        }
      })();
    });

    startDailyNotificationJobs(["Signal"], { signalCli: signalCli });

    healthServer = startHealthServer(
      "Signal",
      healthPort("signal", process.env),
      {
        mongo: mongoProbe,
        signalSocket: () =>
          signalCli.isConnected
            ? { ok: true }
            : { ok: false, detail: "signal-cli WebSocket disconnected" }
      }
    );

    console.log(`Signal: JOEL started successfully \u{2705}`);
  } catch (error) {
    await logError("Signal", "Failed to start Signal app", error);
    // Exit non-zero so the container's restart policy recovers, instead of
    // lingering as a half-started process (e.g. if the rest-api WebSocket was
    // not yet reachable on first connect).
    process.exit(1);
  }
})();
