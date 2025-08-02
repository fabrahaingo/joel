import "dotenv/config";

import { SignalCli } from "signal-sdk";
import { mongodbConnect } from "./db.ts";
import { SignalSession } from "./entities/SignalSession.ts";
import { commands } from "./commands/Commands.ts";
import umami from "./utils/umami.ts";

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

await (async () => {
  try {
    await mongodbConnect();

    // Initialize SignalCli with phone number
    const signal = new SignalCli(SIGNAL_BAT_PATH, SIGNAL_PHONE_NUMBER);

    // Connect to signal-cli daemon
    await signal.connect();

    // Listen for incoming messages
    signal.on("message", (message) => {
      void (async () => {
        if ("receiptMessage" in message.envelope) return;

        await umami.log({ event: "/message-signal" });

        //console.log("Received message:", message.envelope.dataMessage.message);

        const signalSession = new SignalSession(
          signal,
          SIGNAL_PHONE_NUMBER,
          message.envelope.sourceNumber,
          "fr"
        );
        await signalSession.loadUser();

        if (signalSession.user != null)
          await signalSession.user.updateInteractionMetrics();

        const msgText = message.envelope.dataMessage.message;

        for (const command of commands) {
          if (command.regex.test(msgText)) {
            await command.action(signalSession, msgText);
            return;
          }
        }
      })();
    });

    // Graceful shutdown
    //await signal.gracefulShutdown();

    console.log(`\u{2705} JOEL started successfully`);
  } catch (error) {
    console.log(error);
  }
})();
