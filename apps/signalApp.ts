import "dotenv/config";

import { SignalCli } from "signal-sdk";
import { mongodbConnect } from "../db.ts";
import { SignalSession } from "../entities/SignalSession.ts";
import { startDailyNotificationJobs } from "../notifications/notificationScheduler.ts";
import { logError } from "../utils/debugLogger.ts";
import { handleIncomingMessage } from "../utils/messageWorkflow.ts";

const { SIGNAL_PHONE_NUMBER, SIGNAL_BAT_PATH } = process.env;

if (SIGNAL_PHONE_NUMBER === undefined) {
  console.log("Signal: env is not set, bot did not start \u{1F6A9}");
  process.exit(0);
}

if (SIGNAL_BAT_PATH === undefined) {
  throw new Error("SIGNAL_BAT_PATH env variable not set");
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
  try {
    await mongodbConnect();

    // Initialize SignalCli with phone number
    const signalCli = new SignalCli(SIGNAL_BAT_PATH, SIGNAL_PHONE_NUMBER);

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
    console.log(`Signal: JOEL started successfully \u{2705}`);

    // Graceful shutdown handlers
    const shutdown = (signal: string) => {
      console.log(`Signal: Received ${signal}, shutting down gracefully...`);
      void (async () => {
        try {
          signalCli.disconnect();
          console.log("Signal: Client stopped successfully");
          process.exit(0);
        } catch (error) {
          await logError("Signal", `Error during ${signal} shutdown`, error);
          process.exit(1);
        }
      })();
    };

    process.once("SIGINT", () => {
      shutdown("SIGINT");
    });
    process.once("SIGTERM", () => {
      shutdown("SIGTERM");
    });

    // Handle unexpected termination
    process.on("uncaughtException", (error) => {
      void (async () => {
        await logError("Signal", "Uncaught exception", error);
        process.exit(1);
      })();
    });

    process.on("unhandledRejection", (reason) => {
      void (async () => {
        await logError("Signal", "Unhandled promise rejection", reason);
        process.exit(1);
      })();
    });

  } catch (error) {
    await logError("Signal", "Failed to start Signal app", error);
  }
})();
