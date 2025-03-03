import { ChatId, Message, SendMessageOptions } from "node-telegram-bot-api";
import { startKeyboard } from "./keyboards";

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

export async function sendLongText(
  bot: {
    sendMessage: (
      arg0: ChatId,
      arg1: string,
      arg2: SendMessageOptions,
    ) => Promise<Message>;
  },
  chatId: ChatId,
  formattedData: string,
): Promise<void> {
  const mArr = splitText(formattedData, 3000);

  for (const mElm of mArr) {
    await bot.sendMessage(chatId, mElm, startKeyboard);
  }
}
