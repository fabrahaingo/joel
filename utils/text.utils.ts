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
) {
  if (answer === undefined) return null;

  const answers = answer
    .split(/[ ,\-;:]/)
    .map((s) => parseInt(s))
    .filter((i) => i && !isNaN(i) && i <= maxAllowedValue)
    .reduce((acc, i) => {
      if (!acc.includes(i)) acc.push(i);
      return acc;
    }, []);

  if (answers.length == 0) {
    return null;
  }
  return answers;
}
