const { startKeyboard } = require("./keyboards");

function splitText(text, max) {
  const chunks = [];
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

async function sendLongText(bot, chatId, formattedData) {
  const mArr = splitText(formattedData, 3000);

  for (let i = 0; i < mArr.length; i++) {
    await bot.sendMessage(chatId, mArr[i], startKeyboard);
  }
}

module.exports = { sendLongText };
