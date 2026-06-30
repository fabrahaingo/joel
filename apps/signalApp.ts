import "dotenv/config";

import { SignalCli } from "signal-sdk";
import { mongodbConnect, mongodbDisconnect } from "../db.ts";
import { SignalSession, toSignalRecipient } from "../entities/SignalSession.ts";
import { resolvePollVote } from "../entities/SignalPollRegistry.ts";
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

interface ISignalPollVote {
  author?: string;
  authorNumber?: string;
  authorUuid?: string;
  targetSentTimestamp: number;
  optionIndexes: number[];
  voteCount: number;
}

interface ISignalMessage {
  envelope: {
    sourceNumber: string;
    timestamp?: number;
    dataMessage?: {
      message?: string;
      pollVote?: ISignalPollVote;
    };
    receiptMessage?: never;
  };
}
await (async () => {
  try {
    // Initialize SignalCli with phone number
    const signalCli = new SignalCli(SIGNAL_BAT_PATH, SIGNAL_PHONE_NUMBER);

    // Register stopper
    let shuttingDown = false;

    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log(`Signal: Received ${signal}, shutting down...`);

      try {
        signalCli.disconnect();

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

    // Connect to signal-cli daemon, sending read receipts for incoming messages
    await signalCli.connect({ sendReadReceipts: true });

    // Listen for incoming messages
    signalCli.on("message", (message: ISignalMessage) => {
      void (async () => {
        try {
          const { envelope } = message;
          if (envelope.sourceNumber === SIGNAL_PHONE_NUMBER) return;

          const messageSentTime =
            envelope.timestamp != null
              ? new Date(envelope.timestamp)
              : new Date();

          const buildSession = (text: string) =>
            handleIncomingMessage(
              new SignalSession(
                signalCli,
                SIGNAL_PHONE_NUMBER,
                envelope.sourceNumber,
                "fr",
                messageSentTime
              ),
              text,
              { errorContext: "Error processing command" }
            );

          // A vote on a poll menu: map the selected option index back to its
          // menu label, close the poll, then dispatch as a normal command.
          const pollVote = envelope.dataMessage?.pollVote;
          if (pollVote !== undefined) {
            const optionText = resolvePollVote(
              pollVote.targetSentTimestamp,
              pollVote.optionIndexes
            );
            if (optionText === undefined) return;

            await signalCli
              .sendPollTerminate(toSignalRecipient(envelope.sourceNumber), {
                pollTimestamp: pollVote.targetSentTimestamp
              })
              .catch(() => undefined);

            await buildSession(optionText);
            return;
          }

          const msgText = envelope.dataMessage?.message;
          if (msgText === undefined) return;

          await buildSession(msgText);
        } catch (error) {
          await logError("Signal", "Error processing command", error);
        }
      })();
    });

    startDailyNotificationJobs(["Signal"], { signalCli: signalCli });
    console.log(`Signal: JOEL started successfully \u{2705}`);
  } catch (error) {
    await logError("Signal", "Failed to start Signal app", error);
  }
})();
