import "dotenv/config";

import { SignalCli } from "signal-sdk";
import { mongodbConnect } from "../db.ts";
import { SignalSession } from "../entities/SignalSession.ts";
import { processMessage } from "../commands/Commands.ts";
import umami from "../utils/umami.ts";
import { startDailyNotificationJobs } from "../notifications/notificationScheduler.ts";

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

          await umami.log("/message-received", "Signal");

          const signalSession = new SignalSession(
            signalCli,
            SIGNAL_PHONE_NUMBER,
            message.envelope.sourceNumber,
            "fr"
          );
          await signalSession.loadUser();

          if (signalSession.user != null)
            await signalSession.user.updateInteractionMetrics();

          await processMessage(signalSession, msgText);
        } catch (error) {
          console.error("Signal: Error processing command:", error);
        }
      })();
    });

    startDailyNotificationJobs(["Signal"], { signalCli: signalCli });
    console.log(`Signal: JOEL started successfully \u{2705}`);

    // Graceful shutdown
    //await signal.gracefulShutdown();
  } catch (error) {
    console.log(error);
  }
})();
