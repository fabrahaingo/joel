import "dotenv/config";
import {
  MatrixClient,
  SimpleFsStorageProvider,
  RustSdkCryptoStorageProvider
} from "matrix-bot-sdk";
import { ExternalMessageOptions } from "../entities/Session.ts";
import { MessageApp } from "../types.ts";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { SignalCli } from "signal-sdk";
import { WHATSAPP_API_VERSION } from "../entities/WhatsAppSession.ts";
import { logError } from "./debugLogger.ts";

// Load all message apps and their options from environment variables
export async function loadAllMessageApps(messageApps?: MessageApp[]): Promise<{
  messageApps: MessageApp[];
  messageAppOptions: ExternalMessageOptions;
}> {
  const enabledApps: MessageApp[] = [];
  const resolved: ExternalMessageOptions = {};

  if (messageApps == null || messageApps.some((a) => a === "WhatsApp")) {
    const { WHATSAPP_USER_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN } =
      process.env;
    if (WHATSAPP_USER_TOKEN || WHATSAPP_APP_SECRET || WHATSAPP_VERIFY_TOKEN) {
      if (
        WHATSAPP_USER_TOKEN === undefined ||
        WHATSAPP_APP_SECRET === undefined ||
        WHATSAPP_VERIFY_TOKEN === undefined
      ) {
        throw new Error("WhatsApp env vars partially set");
      }
      resolved.whatsAppAPI = new WhatsAppAPI({
        token: WHATSAPP_USER_TOKEN,
        appSecret: WHATSAPP_APP_SECRET,
        webhookVerifyToken: WHATSAPP_VERIFY_TOKEN,
        v: WHATSAPP_API_VERSION
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      resolved.whatsAppAPI.on.sent = ({ phoneID, to }) => {
        //console.log(`Bot ${phoneID} sent to user ${to} ${String(to)}`);
      };
      enabledApps.push("WhatsApp");
    }
  }

  if (messageApps == null || messageApps.some((a) => a === "Signal")) {
    const { SIGNAL_BAT_PATH, SIGNAL_PHONE_NUMBER } = process.env;
    if (SIGNAL_BAT_PATH || SIGNAL_PHONE_NUMBER) {
      if (SIGNAL_BAT_PATH === undefined || SIGNAL_PHONE_NUMBER === undefined) {
        throw new Error("Signal env vars partially set");
      }
      const signalCli = new SignalCli(SIGNAL_BAT_PATH, SIGNAL_PHONE_NUMBER);
      await signalCli.connect();
      resolved.signalCli = signalCli;
      enabledApps.push("Signal");
    }
  }

  if (messageApps == null || messageApps.some((a) => a === "Telegram")) {
    const { TELEGRAM_BOT_TOKEN } = process.env;
    if (TELEGRAM_BOT_TOKEN) {
      resolved.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
      enabledApps.push("Telegram");
    }
  }

  if (messageApps == null || messageApps.some((a) => a === "Matrix")) {
    const { MATRIX_HOME_URL, MATRIX_BOT_TOKEN } = process.env;
    if (MATRIX_HOME_URL || MATRIX_BOT_TOKEN) {
      if (MATRIX_HOME_URL == undefined || MATRIX_BOT_TOKEN == undefined) {
        throw new Error("Matrix env vars partially set");
      }
      // Persist sync token + crypto state
      const storageProvider = new SimpleFsStorageProvider(
        "matrix/matrix-bot.json"
      );
      const cryptoProvider = new RustSdkCryptoStorageProvider(
        "matrix/matrix-crypto"
      );

      try {
        // Use the access token you got from login or registration above.
        const matrixClient = new MatrixClient(
          "https://" + MATRIX_HOME_URL,
          MATRIX_BOT_TOKEN,
          storageProvider,
          cryptoProvider
        );
        await matrixClient.start();
        resolved.matrixClient = matrixClient;
        enabledApps.push("Matrix");
      } catch (error) {
        await logError(
          "Matrix",
          "Matrix: server is currently running, selection is skipped",
          error
        );
      }
    }
  }

  console.log("Loaded message apps for notifications:", enabledApps);

  return { messageApps: enabledApps, messageAppOptions: resolved };
}
