import "dotenv/config";
import { mongodbConnect } from "../db.ts";
import User from "../models/User.ts";
import { MessageApp } from "../types.ts";
import { ExternalMessageOptions, sendMessage } from "../entities/Session.ts";
import umami from "../utils/umami.ts";
import { loadAllMessageApps } from "../utils/loadAllMessageApps.ts";

export interface BroadcastMessageOptions {
  messageApps?: MessageApp[];
  includeBlockedUsers?: boolean;
  enabledAppsOverride?: MessageApp[];
  logger?: (message: string) => void;
  externalMessageOptions?: ExternalMessageOptions;
}

export interface BroadcastMessageResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

export async function broadcastMessage(
  message: string,
  options?: BroadcastMessageOptions
): Promise<BroadcastMessageResult> {
  if (message.trim().length === 0) {
    throw new Error("Broadcast message cannot be empty");
  }
  const { messageApps, messageAppOptions } = await loadAllMessageApps(
    options?.messageApps
  );

  const recipients = await User.find(
    {
      messageApp: { $in: messageApps },
      ...(options?.includeBlockedUsers ? {} : { status: "active" })
    },
    { _id: 0, chatId: 1, messageApp: 1 }
  ).lean();

  let succeeded = 0;

  for (const recipient of recipients) {
    const success = await sendMessage(
      {
        messageApp: recipient.messageApp,
        chatId: recipient.chatId,
        roomId: recipient.roomId,
        hasAccount: true
      },
      message,
      { ...messageAppOptions, useAsyncUmamiLog: true, hasAccount: true }
    );

    if (success) {
      succeeded += 1;
      options?.logger?.(
        `Message delivered to ${recipient.messageApp} user ${recipient.chatId}`
      );
    } else {
      options?.logger?.(
        `Failed to deliver message to ${recipient.messageApp} user ${recipient.chatId}`
      );
    }
  }

  return {
    attempted: recipients.length,
    succeeded,
    failed: recipients.length - succeeded
  };
}

await (async () => {
  const message = `📢 L'équipe JOEL a le plaisir de t'annoncer son arrivée sur *Tchap*, *WhatsApp* et *Matrix* !
Bien entendu nous restons sur Telegram !\\split  
➡️  Tu peux exporter tes suivis JOEL avec la commande /export
Rendez-vous sur notre site :\\split
https://www.joel-officiel.fr/\\split  
🤖 Bonne veille avec JOÉL !`;
  //const message = args.join(" ");

  try {
    await mongodbConnect();
    const result = await broadcastMessage(message, {
      logger: console.log,
      includeBlockedUsers: true,
      messageApps: ["Telegram"]
    });
    console.log(
      `Broadcast completed: ${String(result.succeeded)}/${String(result.attempted)} deliveries succeeded.`
    );
    umami.log({ event: "/message-sent-broadcast" });
    process.exit(result.failed === 0 ? 0 : 2);
  } catch (error) {
    console.error("Broadcast failed:", error);
    process.exit(1);
  }
})();
