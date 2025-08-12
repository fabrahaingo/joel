export function splitText(text: string, max: number): string[] {
  if (!Number.isFinite(max) || max <= 0) return [text];

  const chunks: string[] = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    // Skip leading newlines
    while (i < n && (text[i] === "\n" || text[i] === "\r")) i++;
    if (i >= n) break;

    let end = Math.min(i + max, n);

    if (end < n) {
      // 1) Prefer a newline within [i, end)
      const nl = Math.max(
        text.lastIndexOf("\n", end - 1),
        text.lastIndexOf("\r", end - 1)
      );
      if (nl >= i) {
        end = nl;
      } else {
        // 2) Otherwise prefer last whitespace within [i, end)
        let j = end;
        while (j > i && !isSpace(text.charCodeAt(j - 1))) j--;
        if (j > i) end = j;
      }
    }

    // 3) If we couldn't find a better break, hard-cut at max to ensure progress
    if (end === i) end = Math.min(i + max, n);

    const chunk = trimEdgeNewlines(text.slice(i, end));
    if (chunk.length) chunks.push(chunk);

    i = end;
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
