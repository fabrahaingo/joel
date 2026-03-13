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

/**
 * Replaces all `process.env` values (with at least 8 characters) found in the
 * given string with their variable name as a placeholder (e.g. `<TELEGRAM_BOT_TOKEN>`).
 * This prevents accidental secret leakage in logs.
 */
export const sanitizeSecrets = (input: string): string => {
  const entries = Object.entries(process.env)
    .filter(
      (entry): entry is [string, string] =>
        entry[1] != null && entry[1].trim().length >= 8
    )
    // Sort by value length descending so longer values are replaced first,
    // avoiding partial replacements when one secret is a prefix of another.
    .sort(([, a], [, b]) => b.length - a.length);

  let result = input;
  for (const [key, value] of entries) {
    result = result.split(value).join(`<${key}>`);
  }
  return result;
};

// Patch console methods so that all string arguments are sanitized before output,
// preventing secrets from leaking through ad-hoc console.log calls.
const _consoleLog = console.log.bind(console);
const _consoleWarn = console.warn.bind(console);
const _consoleError = console.error.bind(console);
const _consoleInfo = console.info.bind(console);

const sanitizeArg = (arg: unknown): unknown => {
  if (typeof arg === "string") return sanitizeSecrets(arg);
  if (arg instanceof Error) {
    return sanitizeSecrets(
      `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ""}`
    );
  }
  return arg;
};

console.log = (...args: unknown[]) => {
  _consoleLog(...args.map(sanitizeArg));
};
console.warn = (...args: unknown[]) => {
  _consoleWarn(...args.map(sanitizeArg));
};
console.error = (...args: unknown[]) => {
  _consoleError(...args.map(sanitizeArg));
};
console.info = (...args: unknown[]) => {
  _consoleInfo(...args.map(sanitizeArg));
};

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

export const sendTelegramDebugMessage = async (text: string): Promise<void> => {
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
  const sanitizedMessage = sanitizeSecrets(message);
  const errorText = formatError(error);
  const sanitizedError =
    errorText != null ? sanitizeSecrets(errorText) : undefined;

  if (level === "warning") {
    _consoleWarn(sanitizedMessage);
    if (sanitizedError != null) _consoleWarn(sanitizedError);
  } else {
    _consoleError(sanitizedMessage);
    if (sanitizedError != null) _consoleError(sanitizedError);
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
  const processEnv = (process.env.NODE_ENV ?? "").trim();
  return [
    `${levelEmoji} [${messageApp} (${processEnv.length > 0 ? processEnv : "production"})] ${sanitizeSecrets(message)}`,
    errorText != null ? `Details:\n${sanitizeSecrets(errorText)}` : null
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
