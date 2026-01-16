import "dotenv/config";
import {
  AutojoinRoomsMixin,
  AutojoinUpgradedRoomsMixin,
  MatrixClient,
  RustSdkCryptoStorageProvider,
  SimpleFsStorageProvider
} from "matrix-bot-sdk";
import { closePollMenu, MatrixSession } from "../entities/MatrixSession.ts";
import umami from "../utils/umami.ts";
import { mongodbConnect, mongodbDisconnect } from "../db.ts";
import { startDailyNotificationJobs } from "../notifications/notificationScheduler.ts";
import User from "../models/User.ts";
import { IUser } from "../types.ts";
import { KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import { logError, logWarning } from "../utils/debugLogger.ts";
import { handleIncomingMessage } from "../utils/messageWorkflow.ts";
// Persist sync token + crypto state
import fs from "node:fs";
import { StoreType } from "@matrix-org/matrix-sdk-crypto-nodejs";

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

// Global constant to check if encryption is enabled for the bot
const ENCRYPTION_ENABLED = Boolean(
  process.env.MATRIX_ENCRYPTION_ENABLED ?? "TRUE"
);

if (ENCRYPTION_ENABLED) {
  console.log(`${matrixApp}: Encryption is ENABLED for the bot \u{1F512}`);
}

// Constants for room.join handler
const ROOM_STATE_STABILIZATION_DELAY = 1000; // ms to wait for room state to stabilize
const MESSAGE_HISTORY_CHECK_LIMIT = 10; // number of recent messages to check
const DEFAULT_LANGUAGE = "fr"; // default language for new users
const MULTI_PERSON_ROOM_MESSAGE =
  "JOEL ne permet pas de rejoindre des salons multi-personnes.";

fs.mkdirSync("matrix", { recursive: true });
const storageProvider = new SimpleFsStorageProvider("matrix/matrix-bot.json");
const cryptoProvider = ENCRYPTION_ENABLED
  ? new RustSdkCryptoStorageProvider("matrix/matrix-crypto", StoreType.Sqlite)
  : undefined;

// Use the access token you got from login or registration above.
const client = ENCRYPTION_ENABLED
  ? new MatrixClient(
      "https://" + MATRIX_HOME_URL,
      MATRIX_BOT_TOKEN,
      storageProvider,
      cryptoProvider
    )
  : new MatrixClient(
      "https://" + MATRIX_HOME_URL,
      MATRIX_BOT_TOKEN,
      storageProvider
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

// Handle bot being invited to a new room
client.on("room.join", (roomId: string) => {
  void (async () => {
    try {
      // Wait a moment for room state to stabilize
      await new Promise((resolve) =>
        setTimeout(resolve, ROOM_STATE_STABILIZATION_DELAY)
      );

      // Check if this is a direct message (1-on-1) room
      const otherMemberCount = await getOtherMemberCount(roomId);
      if (otherMemberCount !== 1) {
        // Not a 1-on-1 room, leave it
        console.log(
          `${matrixApp}: leaving room ${roomId} because it has ${String(otherMemberCount)} members besides the bot`
        );
        await client.sendMessage(roomId, {
          msgtype: "m.text",
          body: MULTI_PERSON_ROOM_MESSAGE
        });
        await client.leaveRoom(roomId);
        return;
      }

      // Get the other member's ID
      const otherMembers = await getOtherMembers(roomId);
      const otherUserId = otherMembers[0];

      if (!otherUserId) {
        console.log(
          `${matrixApp}: Could not find other user in room ${roomId}`
        );
        return;
      }

      // Check if there are any messages in the room already
      // If the user has already sent a message, the regular message handler will take care of the welcome
      try {
        const messages = await client.getMessages(roomId, {
          limit: MESSAGE_HISTORY_CHECK_LIMIT
        });
        const hasUserMessages = messages.chunk.some(
          (msg: { sender?: string; type?: string }) =>
            msg.sender === otherUserId && msg.type === "m.room.message"
        );
        if (hasUserMessages) {
          console.log(
            `${matrixApp}: User ${otherUserId} already sent messages in room ${roomId}, skipping proactive welcome`
          );
          return;
        }
      } catch (error) {
        // If we can't check messages, proceed with welcome anyway
        await logWarning(
          matrixApp,
          "Could not check room messages, proceeding with welcome message",
          error
        );
      }

      // Check if user already exists in database
      const previousUser: IUser | null = await User.findOne({
        messageApp: matrixApp,
        chatId: otherUserId
      });

      // Prepare welcome message
      let msgText: string;
      if (previousUser != null) {
        // Existing user
        if (previousUser.status === "blocked") {
          await User.updateOne(
            { _id: previousUser._id },
            { $set: { status: "active", roomId: roomId } }
          );
          umami.log({
            event: "/user-unblocked-joel",
            messageApp: matrixApp,
            hasAccount: true
          });
        } else {
          // Update room ID for active user
          await User.updateOne(
            { _id: previousUser._id },
            { $set: { roomId: roomId } }
          );
        }
        msgText = !previousUser.followsNothing()
          ? KEYBOARD_KEYS.FOLLOWS_LIST.key.text
          : "/start";
      } else {
        // New user - send welcome message
        msgText = "/start";
      }

      // Create a session and send the welcome message
      const matrixSession = new MatrixSession(
        matrixApp,
        client,
        otherUserId,
        roomId,
        DEFAULT_LANGUAGE,
        new Date()
      );

      await handleIncomingMessage(matrixSession, msgText, {
        errorContext: "Error sending welcome message"
      });

      console.log(
        `${matrixApp}: Sent welcome message to ${otherUserId} in room ${roomId}`
      );
    } catch (error) {
      await logError(matrixApp, "Error in room.join handler", error);
    }
  })();
});

let serverUserId: string | undefined;

async function ensureServerUserId() {
  serverUserId ??= await client.getUserId();
  return serverUserId;
}

async function getOtherMembers(roomId: string): Promise<string[]> {
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

  return Array.from(otherMembers);
}

async function getOtherMemberCount(roomId: string) {
  const otherMembers = await getOtherMembers(roomId);
  return otherMembers.length;
}

await (async function () {
  // Register stopper
  let shuttingDown = false;
  try {
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log(`${matrixApp}: Received ${signal}, shutting down...`);

      try {
        // Stop starting new work
        client.stop(); // sets stopSyncing=true (not async)

        // Close DB cleanly
        await mongodbDisconnect();

        // Let stdout flush naturally; do not force-exit yet
        process.exitCode = 0;
      } catch (error) {
        await logError(matrixApp, `Error during ${signal} shutdown`, error);
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

    // Now that everything is set up, start the bot. This will start the sync loop and run until killed.
    serverUserId = await client.getUserId();
    await client.start();

    if (ENCRYPTION_ENABLED) {
      console.log("Bot device ID:", client.crypto.clientDeviceId);
      // @ts-expect-error: clientEd25519 is not exported by the SDK
      console.log("Bot ed25519 fingerprint:", client.crypto.deviceEd25519);
    }

    const messageOptions =
      matrixApp === "Matrix"
        ? { matrixClient: client }
        : { tchapClient: client };

    startDailyNotificationJobs([matrixApp], messageOptions);
    console.log(`${matrixApp}: JOEL started successfully \u{2705}`);
  } catch (error) {
    await logError(matrixApp, "Failed to start app", error);
  }
})();

interface MatrixRoomEvent {
  type: string;
  sender: string;
  event_id: string;
  origin_server_ts?: number; // ms since Unix epoch
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
        // Send read receipt in parallel (don't await)
        void client.sendReadReceipt(roomId, event.event_id);
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
            if (user.status === "active") {
              await User.updateOne(
                { _id: user._id },
                { $set: { status: "blocked" }, $unset: { roomId: 1 } },
                { runValidators: true }
              );
              await umami.logAsync({
                event: "/user-blocked-joel",
                messageApp: matrixApp,
                hasAccount: true
              });
            }
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
                // If a user has joined the room, mark him as active
                if (previousUser.status === "blocked") {
                  await User.updateOne(
                    { _id: previousUser._id },
                    { $set: { status: "active", roomId: roomId } }
                  );
                  umami.log({
                    event: "/user-unblocked-joel",
                    messageApp: matrixApp,
                    hasAccount: true
                  });
                } else {
                  // Update room ID for active user
                  await User.updateOne(
                    { _id: previousUser._id },
                    { $set: { roomId: roomId } }
                  );
                }
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

    if (event.origin_server_ts == null) {
      await logError(matrixApp, "Missing origin_server_ts in received event");
      return;
    }

    const receivedMessageTime = new Date(event.origin_server_ts); // Matrix provides ms epoch

    try {
      const matrixSession = new MatrixSession(
        matrixApp,
        client,
        event.sender,
        roomId,
        "fr",
        receivedMessageTime
      );

      // Check if this is the first message from this user in this room
      let isFirstMessage = false;
      try {
        const messages = await client.getMessages(roomId, {
          limit: MESSAGE_HISTORY_CHECK_LIMIT
        });
        // Check if there are any previous messages from this user
        // Note: The current message may or may not be included in the history yet,
        // so we check if there are 0 or 1 messages (if 1, it could be the current one)
        const userMessageCount = messages.chunk.filter(
          (msg: { sender?: string; type?: string }) =>
            msg.sender === event.sender && msg.type === "m.room.message"
        ).length;
        // If there are 0 messages, it's definitely the first
        // If there's 1, it's likely the current message, so also consider it first
        isFirstMessage = userMessageCount <= 1;
      } catch (error) {
        // If we can't check messages, assume it's not the first message to avoid
        // sending unwanted welcome messages
        await logWarning(
          matrixApp,
          "Could not check room messages for first message detection",
          error
        );
      }

      await handleIncomingMessage(matrixSession, msgText, {
        errorContext: "Error processing command",
        isFirstMessage
      });
    } catch (error) {
      await logError(matrixApp, "Error processing command", error);
    }
  })();
}
