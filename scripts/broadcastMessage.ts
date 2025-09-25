import "dotenv/config";
import { mongodbConnect } from "../db.ts";
import User from "../models/User.ts";
import { MessageApp } from "../types.d.ts";
import { ExternalMessageOptions, sendMessage } from "../entities/Session.ts";
import {
  parseEnabledMessageApps,
  resolveExternalMessageOptions
} from "../utils/messageAppOptions.ts";

export interface BroadcastMessageOptions {
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

  const enabledApps = options?.enabledAppsOverride ?? parseEnabledMessageApps();
  if (enabledApps.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const deliveryOptions = await resolveExternalMessageOptions(
    enabledApps,
    options?.externalMessageOptions
  );

  const recipients = await User.find(
    {
      messageApp: { $in: enabledApps },
      ...(options?.includeBlockedUsers ? {} : { status: "active" })
    },
    { _id: 0, chatId: 1, messageApp: 1 }
  ).lean();

  let succeeded = 0;

  for (const recipient of recipients) {
    const success = await sendMessage(
      recipient.messageApp,
      recipient.chatId,
      message,
      deliveryOptions
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

if (import.meta.main) {
  const [, , ...args] = process.argv;
  if (args.length === 0) {
    console.error("Usage: ts-node utils/broadcastMessage.ts <message>");
    process.exit(1);
  }

  const message = args.join(" ");

  try {
    await mongodbConnect();
    const result = await broadcastMessage(message, {
      logger: console.log
    });
    console.log(
      `Broadcast completed: ${result.succeeded}/${result.attempted} deliveries succeeded.`
    );
    process.exit(result.failed === 0 ? 0 : 2);
  } catch (error) {
    console.error("Broadcast failed:", error);
    process.exit(1);
  }
}
