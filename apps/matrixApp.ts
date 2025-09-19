import "dotenv/config";
import {
  MatrixClient,
  SimpleFsStorageProvider,
  RustSdkCryptoStorageProvider,
  AutojoinRoomsMixin
} from "matrix-bot-sdk";
import { MatrixSession } from "../entities/MatrixSession.ts";
import { processMessage } from "../commands/Commands.ts";
import umami from "../utils/umami.ts";
import { mongodbConnect } from "../db.ts";

const { MATRIX_HOME_URL, MATRIX_BOT_TOKEN } = process.env;
if (MATRIX_HOME_URL == undefined || MATRIX_BOT_TOKEN == undefined)
  throw new Error("MATRIX env is not set");

// Persist sync token + crypto state
const storageProvider = new SimpleFsStorageProvider("matrix-bot.json");
const cryptoProvider = new RustSdkCryptoStorageProvider("matrix-crypto");

// Use the access token you got from login or registration above.
const matrixClient = new MatrixClient(
  "https://" + MATRIX_HOME_URL,
  MATRIX_BOT_TOKEN,
  storageProvider,
  cryptoProvider
);
// Auto-join rooms when invited (required for DMs)
AutojoinRoomsMixin.setupOnClient(matrixClient);

// Before we start the bot, register our command handler
matrixClient.on("room.event", handleCommand);

matrixClient.on("room.join", (roomId: string, event: any) => {
  // The client has been invited to `roomId`
  // if only an other person in the room: send a welcome message
});

await (async function () {
  await mongodbConnect();
  // Now that everything is set up, start the bot. This will start the sync loop and run until killed.
  await matrixClient.start().then(() => {
    console.log(`Matrix: JOEL started successfully \u{2705}`);
  });
})();

// This is the command handler we registered a few lines up
function handleCommand(roomId: string, event: any) {
  void (async () => {
    let msgText: string;
    switch (event.type) {
      case "m.room.message":
        msgText = event.content.body;
        break;
      case "m.reaction":
        msgText = event.content["m.relates_to"].key;
        break;
    }
    if (msgText == null) return;

    // ignore server-notices user; actual ID varies by server (@server:domain or @_server:domain)
    if (/^@_?server:/.test(event.sender)) {
      console.log("Matrix: message from the server");
      console.log(msgText);
      await matrixClient.sendReadReceipt(roomId, event.event_id);
      return;
    }

    if (event.sender === (await matrixClient.getUserId())) return;

    try {
      await umami.log({ event: "/message-matrix" });

      await matrixClient.sendReadReceipt(roomId, event.event_id);

      const matrixSession = new MatrixSession(
        matrixClient,
        event.sender,
        roomId,
        "fr"
      );
      await matrixSession.loadUser();

      if (matrixSession.user != null)
        await matrixSession.user.updateInteractionMetrics();

      await processMessage(matrixSession, msgText);
    } catch (error) {
      console.log(error);
    }

    // Now that we've passed all the checks, we can actually act upon the command
    //await client.replyNotice(roomId, event, "Hello world!");
  })();
}
