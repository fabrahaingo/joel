import "dotenv/config";
import { mongodbConnect } from "../db.ts";
import { ExternalMessageOptions, sendMessage } from "../entities/Session.ts";
import { WHATSAPP_API_VERSION } from "../entities/WhatsAppSession.ts";
import { ErrorMessages } from "../entities/ErrorMessages.ts";
import User from "../models/User.ts";
import { MessageApp } from "../types.ts";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { SignalCli } from "signal-sdk";

const SUPPORTED_MESSAGE_APPS: readonly MessageApp[] = [
  "Telegram",
  "WhatsApp",
  "Signal"
];

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

function parseEnabledMessageApps(): MessageApp[] {
  const { ENABLED_APPS } = process.env;
  if (ENABLED_APPS === undefined) {
    throw new Error("ENABLED_APPS env var not set");
  }

  const parsed = JSON.parse(ENABLED_APPS) as MessageApp[];
  const supportedApps = parsed.filter((app) =>
    SUPPORTED_MESSAGE_APPS.includes(app)
  );

  const unsupportedApps = parsed.filter(
    (app) => !SUPPORTED_MESSAGE_APPS.includes(app)
  );

  if (unsupportedApps.length > 0) {
    console.warn(
      `Ignoring unsupported apps for broadcast: ${unsupportedApps.join(", ")}`
    );
  }

  return supportedApps;
}

async function ensureExternalMessageOptions(
  enabledApps: MessageApp[],
  provided?: ExternalMessageOptions
): Promise<ExternalMessageOptions> {
  const resolved: ExternalMessageOptions = { ...(provided ?? {}) };

  if (enabledApps.includes("WhatsApp") && resolved.whatsAppAPI == null) {
    const { WHATSAPP_USER_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN } =
      process.env;
    if (
      WHATSAPP_USER_TOKEN === undefined ||
      WHATSAPP_APP_SECRET === undefined ||
      WHATSAPP_VERIFY_TOKEN === undefined
    ) {
      throw new Error(ErrorMessages.WHATSAPP_ENV_NOT_SET);
    }

    resolved.whatsAppAPI = new WhatsAppAPI({
      token: WHATSAPP_USER_TOKEN,
      appSecret: WHATSAPP_APP_SECRET,
      webhookVerifyToken: WHATSAPP_VERIFY_TOKEN,
      v: WHATSAPP_API_VERSION
    });
  }

  if (enabledApps.includes("Signal") && resolved.signalCli == null) {
    const { SIGNAL_BAT_PATH, SIGNAL_PHONE_NUMBER } = process.env;
    if (SIGNAL_BAT_PATH === undefined || SIGNAL_PHONE_NUMBER === undefined) {
      throw new Error(ErrorMessages.SIGNAL_ENV_NOT_SET);
    }

    const signalCli = new SignalCli(SIGNAL_BAT_PATH, SIGNAL_PHONE_NUMBER);
    await signalCli.connect();
    resolved.signalCli = signalCli;
  }

  return resolved;
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

  const deliveryOptions = await ensureExternalMessageOptions(
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
