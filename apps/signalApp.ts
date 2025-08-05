import "dotenv/config";

import { SignalCli } from "signal-sdk";
import { mongodbConnect } from "../db.ts";
import { SignalSession } from "../entities/SignalSession.ts";
import { commands } from "../commands/Commands.ts";
import umami from "../utils/umami.ts";

const { SIGNAL_PHONE_NUMBER, TEST_TARGET_PHONE_NUMBER, SIGNAL_BAT_PATH } =
  process.env;

if (SIGNAL_PHONE_NUMBER === undefined) {
  throw new Error("SIGNAL_PHONE_NUMBER env variable not set");
}
if (TEST_TARGET_PHONE_NUMBER === undefined) {
  throw new Error("TEST_TARGET_PHONE_NUMBER env variable not set");
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
        const msgText = message.envelope.dataMessage?.message;
        if (msgText === undefined) return;

        await umami.log({ event: "/message-signal" });

        const signalSession = new SignalSession(
          signalCli,
          SIGNAL_PHONE_NUMBER,
          message.envelope.sourceNumber,
          "fr"
        );
        await signalSession.loadUser();

        if (signalSession.user != null)
          await signalSession.user.updateInteractionMetrics();

        for (const command of commands) {
          if (command.regex.test(msgText)) {
            await command.action(signalSession, msgText);
            return;
          }
        }
      })();
    });

    console.log(`Signal: JOEL started successfully \u{2705}`);

    // Graceful shutdown
    //await signal.gracefulShutdown();
  } catch (error) {
    console.log(error);
  }
})();
