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

const DEFAULT_ALERT_DEDUP_WINDOW_SECONDS = 300; // 5 min

// Read at call-time (not module load) so the window can be tuned via env without
// a restart, and so tests can override it.
const getDedupWindowSeconds = (): number => {
  const raw = process.env.DEBUG_ALERT_DEDUP_WINDOW_SECONDS;
  const parsed = raw != null ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_ALERT_DEDUP_WINDOW_SECONDS;
};

// Collapse the volatile parts of an alert (chatIds, counts, timestamps — all
// digits) so repeats of the "same" alert during an outage share one key.
const alertSignature = (text: string): string => text.replace(/\d+/g, "#");

// In-memory de-dup state, keyed by alert signature. Only the Telegram send is
// throttled — console logging (upstream, in logToConsole) is never suppressed.
const alertDedupState = new Map<
  string,
  { lastSentAt: number; suppressed: number }
>();

// Exposed for tests: clears the in-memory de-dup state between cases.
export const resetAlertDedupState = (): void => {
  alertDedupState.clear();
};

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

// Coolify substitutes shared/global variables at deploy time; when one fails to
// resolve it leaves the literal "{{ ... }}" placeholder in the value instead of
// the real secret. Such a value is unusable (e.g. a "{{...}}" bot token yields a
// bad API URL → 400s), so treat it the same as unset.
const isUnresolvedPlaceholder = (value: string): boolean =>
  /\{\{.*?\}\}/.test(value);

const describeEnvIssue = (
  name: string,
  value: string | undefined
): string | null => {
  if (value == null || value.trim().length === 0) return `${name} is not set`;
  if (isUnresolvedPlaceholder(value))
    return `${name} is unresolved ({{...}} placeholder)`;
  return null;
};

/**
 * Logs at boot whether Telegram debug notifications are usable, naming any env
 * var that is unset or left as an unresolved Coolify placeholder.
 */
export const logTelegramDebugStatus = (): void => {
  const issues = [
    describeEnvIssue("DEBUG_CHAT_ID", DEBUG_CHAT_ID),
    describeEnvIssue("TELEGRAM_DEBUG_BOT_TOKEN", TELEGRAM_DEBUG_BOT_TOKEN)
  ].filter((issue): issue is string => issue != null);

  if (issues.length === 0) {
    console.log("Telegram debug notifications: ENABLED ✅");
  } else {
    console.warn(
      `Telegram debug notifications: DISABLED — ${issues.join("; ")}`
    );
  }
};

export const sendTelegramDebugMessage = async (text: string): Promise<void> => {
  // Skip (and narrow types) when either var is unset, empty, or an unresolved
  // Coolify "{{...}}" placeholder.
  if (
    DEBUG_CHAT_ID == null ||
    DEBUG_CHAT_ID.trim().length === 0 ||
    isUnresolvedPlaceholder(DEBUG_CHAT_ID) ||
    TELEGRAM_DEBUG_BOT_TOKEN == null ||
    TELEGRAM_DEBUG_BOT_TOKEN.trim().length === 0 ||
    isUnresolvedPlaceholder(TELEGRAM_DEBUG_BOT_TOKEN)
  ) {
    return;
  }

  // De-dup: during an outage the same alert fires once per affected user/request.
  // Suppress repeats of an identical-signature alert within the window; surface
  // the suppressed count on the next alert that gets through.
  const windowSeconds = getDedupWindowSeconds();
  const signature = alertSignature(text);
  const now = Date.now();
  const prev = alertDedupState.get(signature);
  if (prev != null && now - prev.lastSentAt < windowSeconds * 1000) {
    prev.suppressed += 1;
    return;
  }
  let outText = text;
  if (prev != null && prev.suppressed > 0) {
    const windowMinutes = Math.max(1, Math.round(windowSeconds / 60));
    outText = `(${String(prev.suppressed)} similar suppressed in last ${String(windowMinutes)}m)\n${text}`;
  }
  alertDedupState.set(signature, { lastSentAt: now, suppressed: 0 });

  const endpoint = `https://api.telegram.org/bot${TELEGRAM_DEBUG_BOT_TOKEN}/sendMessage`;

  try {
    const mArr = splitText(outText, TELEGRAM_MESSAGE_CHAR_LIMIT);

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
    if (axios.isAxiosError(sendError)) {
      console.error(
        "Failed to send debug log to Telegram:",
        sendError.response?.status,
        JSON.stringify(sendError.response?.data)
      );
    } else {
      console.error("Failed to send debug log to Telegram:", sendError);
    }
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
