import emojiRegex from "emoji-regex";
import { MessageApp } from "../types.ts";
import { TELEGRAM_MESSAGE_CHAR_LIMIT } from "../entities/TelegramSession.ts";
import {
  WHATSAPP_MESSAGE_CHAR_LIMIT,
  WHATSAPP_MAX_LINES
} from "../entities/WhatsAppSession.ts";
import { SIGNAL_MESSAGE_CHAR_LIMIT } from "../entities/SignalSession.ts";
import { MATRIX_MESSAGE_CHAR_LIMIT } from "../entities/MatrixSession.ts";

const injectionCharacters = /[<>`{}\[\]\$]/g;
const controlCharacters = /[\u0000-\u001F\u007F]+/g;

export function sanitizeUserInput(input: string): string {
  return input.replace(controlCharacters, "").replace(injectionCharacters, "");
}

export function splitText(
  text: string,
  max: number,
  maxLines?: number
): string[] {
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

  // Count the number of lines in a string (minimum 1, even for empty strings)
  // A string with no newlines is considered to be 1 line
  function countLines(s: string): number {
    let count = 1;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "\n" || s[i] === "\r") {
        count++;
        // Handle \r\n as a single line break
        if (s[i] === "\r" && s[i + 1] === "\n") i++;
      }
    }
    return count;
  }

  // Find the position after the Nth newline in the text starting from startIndex
  function findNthNewlinePosition(
    text: string,
    startIndex: number,
    endIndex: number,
    lineLimit: number
  ): number {
    let linesFound = 0;
    for (let k = startIndex; k < endIndex; k++) {
      if (text[k] === "\n" || text[k] === "\r") {
        linesFound++;
        // Handle \r\n as a single line break
        const isCarriageReturn = text[k] === "\r" && text[k + 1] === "\n";
        if (linesFound >= lineLimit) {
          // Return position after the newline (or \r\n)
          return isCarriageReturn ? k + 2 : k + 1;
        }
        if (isCarriageReturn) k++;
      }
    }
    return -1; // Not found
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

      // 3) Check maxLines constraint if provided
      if (maxLines !== undefined && maxLines > 0) {
        const potentialChunk = segmentText.slice(i, end);
        const lineCount = countLines(potentialChunk);

        if (lineCount > maxLines) {
          const newEnd = findNthNewlinePosition(segmentText, i, end, maxLines);
          // If we found a valid position, use it; otherwise fall through to hard-cut
          if (newEnd > i) {
            end = newEnd;
          }
          // Note: if newEnd is -1 or invalid, we'll proceed to step 4 which does a hard-cut
        }
      }

      // 4) If we couldn't find a better break, hard-cut at max to ensure progress
      if (end === i) end = Math.min(i + max, n);

      const chunk = trimEdgeNewlines(segmentText.slice(i, end));
      if (chunk.length) chunks.push(chunk);

      i = end;
    }
  }
}

export function containsNumber(value: string): boolean {
  return /\d/.test(value);
}

export function getSplitTextMessageSize(text: string, app: MessageApp): number {
  switch (app) {
    case "Matrix":
    case "Tchap":
      return splitText(text, MATRIX_MESSAGE_CHAR_LIMIT).length;

    case "Telegram":
      return splitText(text, TELEGRAM_MESSAGE_CHAR_LIMIT).length;

    case "WhatsApp":
      return splitText(text, WHATSAPP_MESSAGE_CHAR_LIMIT, WHATSAPP_MAX_LINES)
        .length;

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

// Common French stopwords to exclude from search indexing
const FRENCH_STOPWORDS = new Set([
  "le",
  "la",
  "les",
  "un",
  "une",
  "des",
  "du",
  "de",
  "d",
  "au",
  "aux",
  "à",
  "a",
  "et",
  "ou",
  "mais",
  "donc",
  "or",
  "ni",
  "car",
  "ce",
  "cet",
  "cette",
  "ces",
  "dans",
  "par",
  "pour",
  "sur",
  "sous",
  "avec",
  "sans",
  "en",
  "y",
  "il",
  "elle",
  "on",
  "nous",
  "vous",
  "ils",
  "elles",
  "se",
  "sa",
  "son",
  "ses",
  "qui",
  "que",
  "quoi",
  "dont",
  "où",
  "l",
  "s",
  "n",
  "t",
  "m",
  "c",
  "j"
]);

// French month names (used to detect dates in titles)
const FRENCH_MONTHS = new Set([
  "janvier",
  "fevrier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "aout",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "decembre",
  "décembre"
]);

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

/**
 * Normalize French text and remove stopwords
 * Used for indexing publication titles for search
 */
export function normalizeFrenchTextWithStopwords(text: string): string {
  const normalized = normalizeFrenchText(text);
  const words = normalized.split(" ").filter(Boolean);

  // Filter out stopwords and date-related words (numbers and months)
  const filtered = words.filter((word) => {
    // Keep significant numbers (4+ digits, likely years or identifiers like decree numbers)
    if (/^\d{4,}$/.test(word)) return true;

    // Remove short numbers (likely day/month in dates like "15" or "06")
    if (/^\d+$/.test(word)) return false;

    // Remove months
    if (FRENCH_MONTHS.has(word)) return false;

    // Remove stopwords
    if (FRENCH_STOPWORDS.has(word)) return false;

    return true;
  });

  return filtered.join(" ");
}

/**
 * Parse publication title to extract type and cleaned content
 * Example: "Arrêté du 6 janvier 2026 fixant le taux..."
 * Returns: { type: "Arrêté", cleanedTitle: "fixant le taux..." }
 */
export function parsePublicationTitle(title: string): {
  type: string;
  cleanedTitle: string;
} {
  // Extract the first word as the publication type
  const firstSpaceIndex = title.indexOf(" ");
  if (firstSpaceIndex === -1) {
    return { type: title, cleanedTitle: "" };
  }

  const type = title.substring(0, firstSpaceIndex);
  let remainingTitle = title.substring(firstSpaceIndex + 1).trim();

  // Try to remove the date pattern: "du XX month YYYY" or "du XX/XX/XXXX" or similar
  // Pattern: "du" followed by date-like content
  const datePatterns = [
    /^du?\s+\d{1,2}\s+[a-zéèêû]+\s+\d{4}\s*/i, // "du 6 janvier 2026 " (month is lowercase letters with accents)
    /^du?\s+\d{1,2}\/\d{1,2}\/\d{4}\s*/i, // "du 06/01/2026 "
    /^du?\s+\d{1,2}-\d{1,2}-\d{4}\s*/i, // "du 06-01-2026 "
    /^en\s+date\s+du?\s+\d{1,2}\s+[a-zéèêû]+\s+\d{4}\s*/i // "en date du 6 janvier 2026 "
  ];

  for (const pattern of datePatterns) {
    remainingTitle = remainingTitle.replace(pattern, "");
  }

  return {
    type,
    cleanedTitle: remainingTitle.trim()
  };
}

export function levenshteinDistance(
  a: string,
  b: string,
  maxDistance?: number
): number {
  // Early exit if strings are identical
  if (a === b) return 0;

  // Early exit if one string is empty
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Early exit if length difference exceeds maxDistance
  if (maxDistance !== undefined) {
    const lengthDiff = Math.abs(a.length - b.length);
    if (lengthDiff > maxDistance) return maxDistance + 1;
  }

  const rows = a.length + 1;
  const cols = b.length + 1;

  // Use a single array to save memory (we only need previous row)
  let prevRow = Array.from({ length: cols }, (_, i) => i);
  let currRow = new Array<number>(cols);

  for (let i = 1; i < rows; i++) {
    currRow[0] = i;
    let minInRow = currRow[0];

    for (let j = 1; j < cols; j++) {
      if (a[i - 1] === b[j - 1]) {
        currRow[j] = prevRow[j - 1];
      } else {
        currRow[j] =
          1 +
          Math.min(
            prevRow[j], // deletion
            currRow[j - 1], // insertion
            prevRow[j - 1] // substitution
          );
      }
      minInRow = Math.min(minInRow, currRow[j]);
    }

    // Early termination: if minimum in current row exceeds maxDistance, we can stop
    if (maxDistance !== undefined && minInRow > maxDistance) {
      return maxDistance + 1;
    }

    // Swap rows
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[cols - 1];
}

export function fuzzyIncludesNormalized(
  normalizedHaystack: string,
  normalizedNeedle: string,
  haystackWords?: string[],
  needleWords?: string[]
): boolean {
  // Early returns for edge cases
  if (normalizedNeedle.length === 0) return false;
  if (normalizedHaystack.length === 0) return false;

  // Fast path: exact substring match
  if (normalizedHaystack.includes(normalizedNeedle)) return true;

  const finalHaystackWords =
    haystackWords ?? normalizedHaystack.split(" ").filter(Boolean);
  const finalNeedleWords =
    needleWords ?? normalizedNeedle.split(" ").filter(Boolean);

  if (finalNeedleWords.length === 0) return false;

  // Early exit: if needle has more words than haystack, can't match
  if (finalNeedleWords.length > finalHaystackWords.length) {
    // Only try fuzzy match if lengths are close
    if (finalNeedleWords.length > finalHaystackWords.length + 2) {
      return false;
    }
  }

  const canonicalizePlural = (word: string) =>
    word.length > 3 && /[sx]$/.test(word) ? word.slice(0, -1) : word;
  const wordsEqual = (a: string, b: string) =>
    a === b || canonicalizePlural(a) === canonicalizePlural(b);

  // Optimization: Create a Set of haystack words for faster lookup in ordered matching
  const haystackWordSet = new Set(finalHaystackWords);

  // Quick check: do all needle words exist in haystack (ignoring order)?
  let allWordsExist = true;
  for (const needleWord of finalNeedleWords) {
    let found = false;
    if (haystackWordSet.has(needleWord)) {
      found = true;
    } else {
      // Check with plural canonicalization
      for (const haystackWord of finalHaystackWords) {
        if (wordsEqual(haystackWord, needleWord)) {
          found = true;
          break;
        }
      }
    }
    if (!found) {
      allWordsExist = false;
      break;
    }
  }

  // If not all words exist, skip expensive ordered matching
  if (!allWordsExist) {
    // Still try fuzzy match for typos
    return tryFuzzyMatch(
      normalizedNeedle,
      finalHaystackWords,
      finalNeedleWords
    );
  }

  // Check if all the normalized needle words appear in order in the haystack,
  // allowing other words in between (e.g. "ingénieurs armement" should match
  // "corps des ingénieurs de l'armement").
  let lastIndex = -1;
  let orderedMatch = true;
  for (const word of finalNeedleWords) {
    let nextIndex = -1;
    for (let i = lastIndex + 1; i < finalHaystackWords.length; i++) {
      if (wordsEqual(finalHaystackWords[i], word)) {
        nextIndex = i;
        break;
      }
    }

    if (nextIndex === -1) {
      orderedMatch = false;
      break;
    }
    lastIndex = nextIndex;
  }

  if (orderedMatch) return true;

  // Only try expensive fuzzy matching if ordered match was close
  return tryFuzzyMatch(normalizedNeedle, finalHaystackWords, finalNeedleWords);
}

/**
 * Helper function for fuzzy matching using Levenshtein distance
 * Separated to avoid duplicate code and allow early returns
 */
function tryFuzzyMatch(
  normalizedNeedle: string,
  haystackWords: string[],
  needleWords: string[]
): boolean {
  const windowSize = Math.max(1, needleWords.length);
  const allowedDistance = Math.max(
    1,
    Math.round(normalizedNeedle.length * 0.15)
  );

  // Early exit: if the allowed distance is very small and we have many words,
  // the fuzzy match is unlikely to help
  if (allowedDistance < 2 && needleWords.length > 3) {
    return false;
  }

  // Optimization: limit how many windows we check
  const maxWindowsToCheck = Math.min(
    haystackWords.length - windowSize + 1,
    50 // Don't check more than 50 windows
  );

  for (let i = 0; i < maxWindowsToCheck; i++) {
    const currentWindow = haystackWords.slice(i, i + windowSize).join(" ");

    // Quick length check before expensive Levenshtein calculation
    const lengthDiff = Math.abs(currentWindow.length - normalizedNeedle.length);
    if (lengthDiff > allowedDistance * 2) {
      continue; // Skip this window, length difference is too large
    }

    // Pass maxDistance for early termination in Levenshtein calculation
    if (
      levenshteinDistance(currentWindow, normalizedNeedle, allowedDistance) <=
      allowedDistance
    ) {
      return true;
    }
  }

  return false;
}

export function fuzzyIncludes(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeFrenchText(needle);
  const normalizedHaystack = normalizeFrenchText(haystack);

  return fuzzyIncludesNormalized(normalizedHaystack, normalizedNeedle);
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

  // Extract links first and replace with null-byte-delimited placeholders so
  // that underscores inside URLs are not mistakenly treated as italic markers
  // when the bold/italic regexes run.
  const links: string[] = [];
  let out = input.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, text: string, url: string) => {
      const idx = links.length;
      links.push(`<a href="${url}" rel="noopener noreferrer">${text}</a>`);
      return `\x00${idx}\x00`;
    }
  );

  // Bold: *text*
  out = out.replace(
    /\*([^*\s][^*]*?)\*/g,
    (_m, t: string) => `<strong>${t}</strong>`
  );
  // Italic: _text_
  out = out.replace(/_([^_\s][^_]*?)_/g, (_m, t: string) => `<em>${t}</em>`);

  // Restore links
  out = out.replace(/\x00(\d+)\x00/g, (_m, i: string) => links[parseInt(i)]);

  out = out.replace(/\n/g, `<br />`);

  return out;
}
