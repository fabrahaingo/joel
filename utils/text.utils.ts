export function splitText(text: string, max: number): string[] {
  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = startIndex + max;

    if (endIndex < text.length) {
      // Check for markdown element or word boundary within the chunk
      while (endIndex > startIndex && !text.charAt(endIndex).includes("\n")) {
        endIndex--;
      }
    }

    const chunk = text.slice(startIndex, endIndex).trim();
    chunks.push(chunk);

    startIndex = endIndex;
    while (startIndex < text.length && text.charAt(startIndex).includes("\n")) {
      startIndex++;
    }
  }

  return chunks;
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
