import { ExternalMessageOptions } from "../entities/Session.ts";
import { ErrorMessages } from "../entities/ErrorMessages.ts";
import { WHATSAPP_API_VERSION } from "../entities/WhatsAppSession.ts";
import { MessageApp } from "../types.ts";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";
import { SignalCli } from "signal-sdk";

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
    console.warn(
      `Ignoring unsupported apps: ${unsupportedApps.join(", ")}`
    );
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

  return resolved;
}
