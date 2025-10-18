import "dotenv/config";
import {
  MatrixClient,
  SimpleFsStorageProvider,
  RustSdkCryptoStorageProvider,
  AutojoinRoomsMixin
} from "matrix-bot-sdk";
import { closePollMenu, MatrixSession } from "../entities/MatrixSession.ts";
import { processMessage } from "../commands/Commands.ts";
import umami from "../utils/umami.ts";
import { mongodbConnect } from "../db.ts";

const { MATRIX_HOME_URL, MATRIX_BOT_TOKEN } = process.env;
if (MATRIX_HOME_URL == undefined || MATRIX_BOT_TOKEN == undefined) {
  console.log("Matrix env is not set");
  console.log("Shutting down JOEL Matrix bot... \u{1F6A9}");
  process.exit(0);
}

// Persist sync token + crypto state
const storageProvider = new SimpleFsStorageProvider("matrix/matrix-bot.json");
const cryptoProvider = new RustSdkCryptoStorageProvider("matrix/matrix-crypto");

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

/*
matrixClient.on("room.join", (_roomId: string, _event: unknown) => {
  // The client has been invited to `roomId`
  // if only an other person in the room: send a welcome message
});
 */

let serverUserId: string | undefined;

await (async function () {
  await mongodbConnect();

  // Now that everything is set up, start the bot. This will start the sync loop and run until killed.
  await matrixClient.start();
  serverUserId = await matrixClient.getUserId();
})().then(() => {
  console.log(`Matrix: JOEL started successfully \u{2705}`);
});

interface MatrixRoomEvent {
  type: string;
  sender: string;
  event_id: string;
  content: {
    body?: string;
    "m.relates_to"?: {
      rel_type: string;
      event_id?: string;
      key?: string;
      "m.in_reply_to"?: { event_id: string };
    };
    "org.matrix.msc3381.poll.response": { answers: string[] };
  };
}

// This is the command handler we registered a few lines up
function handleCommand(roomId: string, event: MatrixRoomEvent) {
  void (async () => {
    // ignore message from itself
    if (event.sender === serverUserId) return;

    let msgText: string | undefined;
    switch (event.type) {
      case "m.room.message":
        msgText = event.content.body;
        break;

      case "m.reaction":
        msgText = event.content["m.relates_to"]?.key;
        break;

      case "org.matrix.msc3381.poll.response": {
        const eventId = event.content["m.relates_to"]?.event_id;
        if (eventId != null) await closePollMenu(matrixClient, roomId, eventId);
        msgText = event.content["org.matrix.msc3381.poll.response"].answers[0];
      }
    }
    if (msgText == null) return;

    // ignore server-notices user; actual ID varies by server (@server:domain or @_server:domain)
    if (/^@_?server:/.test(event.sender)) {
      console.log("Matrix: message from the server");
      console.log(msgText);
      await matrixClient.sendReadReceipt(roomId, event.event_id);
      return;
    }

    try {
      await umami.log("/message-received", "Matrix");

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
