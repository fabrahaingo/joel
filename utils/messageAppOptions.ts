import { ExternalMessageOptions } from "../entities/Session.ts";
import { ErrorMessages } from "../entities/ErrorMessages.ts";
import { WHATSAPP_API_VERSION } from "../entities/WhatsAppSession.ts";
import { MessageApp } from "../types.ts";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { SignalCli } from "signal-sdk";
import {
  MatrixClient,
  RustSdkCryptoStorageProvider,
  SimpleFsStorageProvider
} from "matrix-bot-sdk";

export const SUPPORTED_MESSAGE_APPS: readonly MessageApp[] = [
  "Telegram",
  "WhatsApp",
  "Signal",
  "Matrix"
] as const;

export function parseEnabledMessageApps(
  enabledAppsEnv: string | undefined = process.env.ENABLED_APPS
): MessageApp[] {
  if (enabledAppsEnv === undefined) {
    throw new Error("ENABLED_APPS env var not set");
  }

  const parsed = JSON.parse(enabledAppsEnv) as MessageApp[];
  const supportedApps = parsed.filter((app) =>
    SUPPORTED_MESSAGE_APPS.includes(app)
  );

  const unsupportedApps = parsed.filter(
    (app) => !SUPPORTED_MESSAGE_APPS.includes(app)
  );

  if (unsupportedApps.length > 0) {
    console.warn(`Ignoring unsupported apps: ${unsupportedApps.join(", ")}`);
  }

  return supportedApps;
}

export async function resolveExternalMessageOptions(
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

  if (enabledApps.includes("Matrix") && resolved.matrixClient == null) {
    const { MATRIX_HOME_URL, MATRIX_BOT_TOKEN } = process.env;
    if (MATRIX_HOME_URL == undefined || MATRIX_BOT_TOKEN == undefined)
      throw new Error("MATRIX env is not set");

    const storageProvider = new SimpleFsStorageProvider(
      "matrix/matrix-bot.json"
    );
    const cryptoProvider = new RustSdkCryptoStorageProvider(
      "matrix/matrix-crypto"
    );

    const matrixClient = new MatrixClient(
      "https://" + MATRIX_HOME_URL,
      MATRIX_BOT_TOKEN,
      storageProvider,
      cryptoProvider
    );

    // Ensure E2EE is initialized for scripts (like notifyUsers) that send to encrypted rooms
    await matrixClient.start();
    resolved.matrixClient = matrixClient;
  }

  return resolved;
}
