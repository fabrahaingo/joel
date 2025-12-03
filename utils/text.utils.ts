import emojiRegex from "emoji-regex";
import { MessageApp } from "../types";
import { TELEGRAM_MESSAGE_CHAR_LIMIT } from "../entities/TelegramSession.ts";
import { WHATSAPP_MESSAGE_CHAR_LIMIT } from "../entities/WhatsAppSession.ts";
import { SIGNAL_MESSAGE_CHAR_LIMIT } from "../entities/SignalSession.ts";
import { MATRIX_MESSAGE_CHAR_LIMIT } from "../entities/MatrixSession.ts";

const injectionCharacters = /[<>`{}\[\]\$]/g;
const controlCharacters = /[\u0000-\u001F\u007F]+/g;

export function sanitizeUserInput(input: string): string {
  return input.replace(controlCharacters, "").replace(injectionCharacters, "");
}

export function splitText(text: string, max: number): string[] {
  if (!Number.isFinite(max) || max <= 0) return [text];

  const chunks: string[] = [];
  const FORCE_SPLIT = "\\split";
  const segments: string[] = [];

  let start = 0;
  while (true) {
    const idx = text.indexOf(FORCE_SPLIT, start);
    if (idx === -1) {
      segments.push(text.slice(start));
      break;
    }

    segments.push(text.slice(start, idx));
    start = idx + FORCE_SPLIT.length;
  }

  for (const segment of segments) {
    appendSegment(segment);
    // Processing each segment independently automatically enforces the
    // explicit split markers—no extra state required here.
  }

  return chunks;

  // Fast-ish check for common space chars
  function isSpace(code: number): boolean {
    return code === 32 || code === 9 || code === 160 || code === 0x202f; // ' ', '\t', NBSP, NNBSP
  }
  function trimEdgeNewlines(s: string): string {
    let a = 0,
      b = s.length;
    while (a < b && (s.charCodeAt(a) === 10 || s.charCodeAt(a) === 13)) a++; // \n or \r
    while (b > a && (s.charCodeAt(b - 1) === 10 || s.charCodeAt(b - 1) === 13))
      b--;
    return s.slice(a, b);
  }

  function appendSegment(segmentText: string): void {
    const n = segmentText.length;
    let i = 0;

    while (i < n) {
      // Skip leading newlines
      while (i < n && (segmentText[i] === "\n" || segmentText[i] === "\r")) i++;
      if (i >= n) break;

      let end = Math.min(i + max, n);

      if (end < n) {
        // 1) Prefer a newline within [i, end)
        const nl = Math.max(
          segmentText.lastIndexOf("\n", end - 1),
          segmentText.lastIndexOf("\r", end - 1)
        );
        if (nl >= i) {
          end = nl;
        } else {
          // 2) Otherwise prefer last whitespace within [i, end)
          let j = end;
          while (j > i && !isSpace(segmentText.charCodeAt(j - 1))) j--;
          if (j > i) end = j;
        }
      }

      // 3) If we couldn't find a better break, hard-cut at max to ensure progress
      if (end === i) end = Math.min(i + max, n);

      const chunk = trimEdgeNewlines(segmentText.slice(i, end));
      if (chunk.length) chunks.push(chunk);

      i = end;
    }
  }
}

export function getSplitTextMessageSize(text: string, app: MessageApp): number {
  switch (app) {
    case "Matrix":
    case "Tchap":
      return splitText(text, MATRIX_MESSAGE_CHAR_LIMIT).length;

    case "Telegram":
      return splitText(text, TELEGRAM_MESSAGE_CHAR_LIMIT).length;

    case "WhatsApp":
      return splitText(text, WHATSAPP_MESSAGE_CHAR_LIMIT).length;

    case "Signal":
      return splitText(text, SIGNAL_MESSAGE_CHAR_LIMIT).length;

    default:
      throw new Error("Unknown message app");
  }
}

export function parseIntAnswers(
  answer: string | undefined,
  maxAllowedValue: number
): number[] {
  if (answer === undefined) return [];

  return answer
    .split(/[ ,\-;:]/)
    .map((s) => parseInt(s))
    .filter((i) => i && !isNaN(i) && i <= maxAllowedValue)
    .reduce((acc: number[], i) => {
      if (!acc.includes(i)) acc.push(i);
      return acc;
    }, []);
}

export function escapeRegExp(text: string): string {
  // $& in the replacement expands to the whole match, so each metacharacter
  // is prefixed with a backslash.
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function removeSpecialCharacters(text: string): string {
  // $& in the replacement expands to the whole match, so each metacharacter
  // is prefixed with a backslash.
  return text.replace(/[.*+?^${}()|[\]\\]/g, "");
}

export function normalizeFrenchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;

  const distance = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });

  for (let j = 0; j < cols; j++) distance[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (a[i - 1] === b[j - 1]) {
        distance[i][j] = distance[i - 1][j - 1];
      } else {
        distance[i][j] =
          1 +
          Math.min(
            distance[i - 1][j],
            distance[i][j - 1],
            distance[i - 1][j - 1]
          );
      }
    }
  }

  return distance[rows - 1][cols - 1];
}

export function fuzzyIncludes(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeFrenchText(needle);
  if (normalizedNeedle.length === 0) return false;

  const normalizedHaystack = normalizeFrenchText(haystack);
  if (normalizedHaystack.includes(normalizedNeedle)) return true;

  const haystackWords = normalizedHaystack.split(" ").filter(Boolean);
  const needleWords = normalizedNeedle.split(" ").filter(Boolean);
  const windowSize = Math.max(1, needleWords.length);
  const allowedDistance = Math.max(
    1,
    Math.round(normalizedNeedle.length * 0.15)
  );

  for (let i = 0; i <= haystackWords.length - windowSize; i++) {
    const currentWindow = haystackWords.slice(i, i + windowSize).join(" ");
    if (levenshteinDistance(currentWindow, normalizedNeedle) <= allowedDistance)
      return true;
  }

  return false;
}

// Function to convert an array to CSV
export function convertToCSV(array: never[]) {
  if (array.length < 1) {
    return null;
  }
  // Extract the keys from the first element
  const headers = Object.keys(array[0]).join(",");

  // Convert each element to a CSV row
  const rows = array
    .map((element: never) => Object.values(element).join(","))
    .join("\n");

  // Combine headers and rows
  return `${headers}\n${rows}`;
}

export function trimStrings<T>(value: T): T {
  // Base cases
  if (typeof value === "string") {
    // value is a primitive string → trim it
    return value.trim() as T;
  }

  if (Array.isArray(value)) {
    // value is an array → process each element
    return value.map(trimStrings) as unknown as T;
  }

  if (value !== null && typeof value === "object") {
    // value is a plain object → iterate over its keys
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = trimStrings(v);
    }
    return result as T;
  }

  // Any other primitive (number, boolean, null, undefined, symbol, bigint) – return as-is
  return value;
}

// Remove accents and light Markdown/emoji, return ASCII-ish text.
export function markdown2plainText(msg: string): string {
  function deburr(input: string): string {
    const decomposed = input.normalize("NFD");

    const stripped = decomposed.replace(/[\u0300-\u036f]/gu, "");

    return stripped
      .replace(/ß/g, "ss")
      .replace(/Æ/g, "AE")
      .replace(/æ/g, "ae")
      .replace(/Ø/g, "O")
      .replace(/ø/g, "o")
      .replace(/Ð/g, "D")
      .replace(/ð/g, "d")
      .replace(/Þ/g, "Th")
      .replace(/þ/g, "th")
      .replace(/Œ/g, "OE")
      .replace(/œ/g, "oe");
  }

  const emoteFreeText = msg.replace(emojiRegex(), "");

  const formattingFreeText = emoteFreeText.replace(/[_*]/gu, "");

  const accentFreeText = deburr(formattingFreeText);

  return accentFreeText;
}

export function markdown2WHMarkdown(input: string): string {
  return input.replace(/\[(.*?)]\((.*?)\)/g, "*$1*\n$2");
}

export function markdown2html(input: string): string {
  // Minimal markdown → HTML: [text](url), **bold** / __bold__, *italic* / _italic_
  /*
    const escapeHtml = (s: string) =>
      s.replace(
        /[&<>"']/g,
        (ch) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
          })[ch]!
      );

    // Escape all HTML first so inserted tags are the only HTML.
    let out = escapeHtml(input);
     */

  // Links: [text](url)
  let out = input.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, text: string, url: string) =>
      `<a href="${url}" rel="noopener noreferrer">${text}</a>`
  );

  // Bold: *text*
  out = out.replace(
    /\*([^*\s][^*]*?)\*/g,
    (_m, t: string) => `<strong>${t}</strong>`
  );
  // Italic: _text_

  out = out.replace(/_([^_\s][^_]*?)_/g, (_m, t: string) => `<em>${t}</em>`);

  out = out.replace(/\n/g, `<br />`);

  return out;
}
