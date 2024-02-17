import { Keyboard } from "../types";
import { startKeyboard } from "./keyboards";

function splitText(text: string, max: number): string[] {
  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = startIndex + max;

    if (endIndex < text.length) {
      // Check for markdown element or word boundary within the chunk
      while (endIndex > startIndex && !/\n/.test(text.charAt(endIndex))) {
        endIndex--;
      }
    }

    const chunk = text.slice(startIndex, endIndex).trim();
    chunks.push(chunk);

    startIndex = endIndex;
    while (startIndex < text.length && /\n/.test(text.charAt(startIndex))) {
      startIndex++;
    }
  }

  return chunks;
}

async function sendLongText(
  bot: { sendMessage: (arg0: any, arg1: string, arg2: Keyboard) => any },
  chatId: any,
  formattedData: any
) {
  const mArr: string[] = splitText(formattedData, 3000);

  for (let i = 0; i < mArr.length; i++) {
    await bot.sendMessage(chatId, mArr[i], startKeyboard);
  }
}

export default { sendLongText, splitText };
