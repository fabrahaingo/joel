import TelegramBot from "node-telegram-bot-api";
import { startKeyboard } from "./keyboards";

export function splitText(text: string, max: number): string[] {
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

export async function sendLongText(
  bot: TelegramBot,
  chatId: any,
  formattedData: string,
  replyOptions?: TelegramBot.SendMessageOptions
): Promise<void> {
  const mArr = splitText(formattedData, 3000);

  for (let i = 0; i < mArr.length; i++) {
    if (i == mArr.length-1 && replyOptions !== undefined) {
      await bot.sendMessage(chatId, mArr[i], replyOptions);
    } else {
      await bot.sendMessage(chatId, mArr[i], startKeyboard);
    }
  }
}
