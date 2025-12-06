import "dotenv/config";
import {
  MatrixClient,
  SimpleFsStorageProvider,
  RustSdkCryptoStorageProvider,
  AutojoinUpgradedRoomsMixin,
  AutojoinRoomsMixin
} from "matrix-bot-sdk";
import { closePollMenu, MatrixSession } from "../entities/MatrixSession.ts";
import umami from "../utils/umami.ts";
import { mongodbConnect } from "../db.ts";
import { startDailyNotificationJobs } from "../notifications/notificationScheduler.ts";
import User from "../models/User.ts";
import { IUser } from "../types";
import { KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import { logError, logWarning } from "../utils/debugLogger.ts";
import { handleIncomingMessage } from "../utils/messageWorkflow.ts";
const { MATRIX_HOME_URL, MATRIX_BOT_TOKEN, MATRIX_BOT_TYPE } = process.env;
if (
  MATRIX_HOME_URL == undefined ||
  MATRIX_BOT_TOKEN == undefined ||
  MATRIX_BOT_TYPE == undefined
) {
  console.log(`Matrix: env is not set, bot did not start \u{1F6A9}`);
  process.exit(0);
}

if (!["Matrix", "Tchap"].some((m) => m === MATRIX_BOT_TYPE)) {
  console.log(
    `Matrix: MATRIX_BOT_TYPE set to ${MATRIX_BOT_TYPE} ! Only Matrix and Tchap modes are allowed for matrix apps`
  );
  process.exit(1);
}
const matrixApp = MATRIX_BOT_TYPE as "Matrix" | "Tchap";

// Persist sync token + crypto state
import fs from "node:fs";
fs.mkdirSync("matrix", { recursive: true });
const storageProvider = new SimpleFsStorageProvider("matrix/matrix-bot.json");
const cryptoProvider = new RustSdkCryptoStorageProvider("matrix/matrix-crypto");

// Use the access token you got from login or registration above.
const client = new MatrixClient(
  "https://" + MATRIX_HOME_URL,
  MATRIX_BOT_TOKEN,
  storageProvider,
  cryptoProvider
);

AutojoinRoomsMixin.setupOnClient(client);
AutojoinUpgradedRoomsMixin.setupOnClient(client); // optional but nice to have

// Before we start the bot, register our command handler
client.on("room.event", handleCommand);

// Migrate your per-room state when the upgrade completes
client.on(
  "room.upgraded",
  (
    newRoomId: string,
    createEvent: { content?: { predecessor?: { room_id?: string } } }
  ) =>
    void (async () => {
      const oldRoomId = createEvent.content?.predecessor?.room_id;
      if (!oldRoomId) return;

      await User.updateMany(
        { roomId: oldRoomId },
        { $set: { roomId: newRoomId } }
      );
    })()
);
/*
client.on("room.join", (_roomId: string, _event: unknown) => {
  // The client has been invited to `roomId`
  // if only another person in the room: send a welcome message
});
 */

let serverUserId: string | undefined;

async function ensureServerUserId() {
  serverUserId ??= await client.getUserId();
  return serverUserId;
}

async function getOtherMemberCount(roomId: string) {
  const stateEvents = await client.getRoomState(roomId);
  const otherMembers = new Set<string>();
  const currentUserId = await ensureServerUserId();

  for (const event of stateEvents as {
    type?: string;
    state_key?: string;
    content?: { membership?: string };
  }[]) {
    if (event.type !== "m.room.member") continue;
    const membership = event.content?.membership;
    if (membership !== "join" && membership !== "invite") continue;
    const memberId = event.state_key;
    if (memberId == null || memberId === currentUserId) continue;
    otherMembers.add(memberId);
  }

  return otherMembers.size;
}

await (async function () {
  await mongodbConnect();

  // Now that everything is set up, start the bot. This will start the sync loop and run until killed.
  serverUserId = await client.getUserId();
  await client.start();

  console.log("Bot device ID:", client.crypto.clientDeviceId);
  // @ts-expect-error: clientEd25519 is not exported by the SDK
  console.log("Bot ed25519 fingerprint:", client.crypto.deviceEd25519);

  const messageOptions =
    matrixApp === "Matrix" ? { matrixClient: client } : { tchapClient: client };

  startDailyNotificationJobs([matrixApp], messageOptions);
})().then(() => {
  console.log(`${matrixApp}: JOEL started successfully \u{2705}`);
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
    membership?: string;
    "org.matrix.msc3381.poll.response"?: { answers?: string[] };
    "m.poll.response"?: { answers?: string[] };
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
        await client.sendReadReceipt(roomId, event.event_id);
        msgText = event.content.body;
        break;

      case "m.reaction":
        msgText = event.content["m.relates_to"]?.key;
        break;

      case "m.poll.response":
      case "org.matrix.msc3381.poll.response": {
        const eventId = event.content["m.relates_to"]?.event_id;
        if (eventId != null) await closePollMenu(client, roomId, eventId);
        const payload =
          event.content["m.poll.response"] ??
          event.content["org.matrix.msc3381.poll.response"];
        msgText = payload?.answers?.[0];
        break;
      }

      case "m.room.member": {
        if (event.content.membership === "leave") {
          const user: IUser | null = await User.findOne({
            messageApp: matrixApp,
            roomId: roomId,
            chatId: event.sender
          });
          if (user != null) {
            // If a user has left the room, mark him as blocked
            await User.updateOne(
              { _id: user._id },
              { $set: { status: "active" }, $unset: { roomId: 1 } },
              { runValidators: true }
            );
            umami.log({
              event: "/user-blocked-joel",
              messageApp: matrixApp
            });
          }
          return;
        } else if (event.content.membership === "join") {
          // leave non-direct rooms when a new member joins
          try {
            const otherMemberCount = await getOtherMemberCount(roomId);
            if (otherMemberCount > 1) {
              console.log(
                `${matrixApp}: leaving room ${roomId} because it has ${String(otherMemberCount)} members besides the bot`
              );
              await client.sendMessage(roomId, {
                msgtype: "m.text",
                body: "JOEL ne permet pas de rejoindre des salons multi-personnes."
              });
              await client.leaveRoom(roomId);
              return;
            } else {
              // only 1 other person in the room
              const previousUser: IUser | null = await User.findOne({
                messageApp: matrixApp,
                chatId: event.sender
              });
              if (previousUser != null) {
                // If a user has left the room, mark him as blocked
                await User.updateOne(
                  { _id: previousUser._id },
                  { $set: { status: "active", roomId: roomId } }
                );
                umami.log({
                  event: "/user-unblocked-joel",
                  messageApp: matrixApp
                });
                if (!previousUser.followsNothing())
                  msgText = KEYBOARD_KEYS.FOLLOWS_LIST.key.text;
                else msgText = "/start";
              } else msgText = "/start"; // Send the welcome message to the new member
              break;
            }
          } catch {
            // unable to inspect room membership
            return;
          }
        } else return;
      }
    }
    if (msgText == null) return;

    // ignore server-notices user; actual ID varies by server (@server:domain or @_server:domain)
    if (/^@_?server:/.test(event.sender)) {
      await logWarning(matrixApp, `${matrixApp}: message from the server`);
      if (event.type === "m.room.message")
        await client.sendReadReceipt(roomId, event.event_id);
      return;
    }

    try {
      const matrixSession = new MatrixSession(
        matrixApp,
        client,
        event.sender,
        roomId,
        "fr"
      );
      await handleIncomingMessage(matrixSession, msgText, {
        errorContext: "Error processing command"
      });
    } catch (error) {
      await logError(matrixApp, "Error processing command", error);
    }
  })();
}
