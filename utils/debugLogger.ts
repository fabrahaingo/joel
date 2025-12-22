import axios from "axios";
import { MessageApp } from "../types.ts";
import umami from "./umami.ts";
import { splitText } from "./text.utils.ts";
import {
  TELEGRAM_COOL_DOWN_DELAY_SECONDS,
  TELEGRAM_MESSAGE_CHAR_LIMIT
} from "../entities/TelegramSession.ts";

type LogLevel = "warning" | "error";

const DEBUG_CHAT_ID = process.env.DEBUG_CHAT_ID;
const TELEGRAM_DEBUG_BOT_TOKEN = process.env.TELEGRAM_DEBUG_BOT_TOKEN;

const formatError = (error: unknown): string | null => {
  if (error == null) return null;
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch (stringifyError) {
    return `Unknown error (could not serialize): ${String(stringifyError)}`;
  }
};

const sendTelegramDebugMessage = async (text: string): Promise<void> => {
  if (DEBUG_CHAT_ID == null || TELEGRAM_DEBUG_BOT_TOKEN == null) return;

  const endpoint = `https://api.telegram.org/bot${TELEGRAM_DEBUG_BOT_TOKEN}/sendMessage`;

  try {
    const mArr = splitText(text, TELEGRAM_MESSAGE_CHAR_LIMIT);

    for (const m of mArr) {
      await axios.post(endpoint, {
        chat_id: DEBUG_CHAT_ID,
        text: m
      });
      // prevent hitting the Telegram API rate limit
      await new Promise((resolve) =>
        setTimeout(resolve, TELEGRAM_COOL_DOWN_DELAY_SECONDS * 1000)
      );
    }
  } catch (sendError) {
    console.error("Failed to send debug log to Telegram:", sendError);
  }
};

const logToConsole = (
  level: LogLevel,
  message: string,
  error?: unknown
): void => {
  if (level === "warning") {
    console.warn(message);
    if (error) console.warn(error);
  } else {
    console.error(message);
    if (error) console.error(error);
  }
};

const buildLogMessage = (
  level: LogLevel,
  messageApp: MessageApp,
  message: string,
  error?: unknown
): string => {
  const levelEmoji = level === "error" ? "❌" : "⚠️";
  const errorText = formatError(error);
  return [
    `${levelEmoji} [${messageApp} (${process.env.NODE_env ?? "production"})] ${message}`,
    errorText != null ? `Details:\n${errorText}` : null
  ]
    .filter((part): part is string => part != null)
    .join("\n");
};

export const logWarning = async (
  messageApp: MessageApp,
  message: string,
  error?: unknown
): Promise<void> => {
  logToConsole("warning", message, error);
  await sendTelegramDebugMessage(
    buildLogMessage("warning", messageApp, message, error)
  );
};

export const logError = async (
  messageApp: MessageApp,
  message: string,
  error?: unknown
): Promise<void> => {
  logToConsole("error", message, error);
  umami.log({ event: "/console-log", messageApp });
  await sendTelegramDebugMessage(
    buildLogMessage("error", messageApp, message, error)
  );
};
