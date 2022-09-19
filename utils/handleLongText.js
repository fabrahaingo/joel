const { startKeyboard } = require("../utils/keyboards")
const max = 4096

function handleLongText(longText) {
    let messagesArray = []
    let message = ''
    let nbOfCharsToLastNewLine = 0
    let stringToAddToNextMessage = ''
    let slices = longText.length / max
    for (let i = 0; i < slices; i++) {
        if (stringToAddToNextMessage.length > 0) {
            message = stringToAddToNextMessage + longText.slice(i * max, (i + 1) * max)
        } else {
            message = longText.slice(i * max, (i + 1) * max)
        }

        // to prevent markdown error, we must make sure the message is not split in the middle of a markdown element
        nbOfCharsToLastNewLine = message.lastIndexOf("\n\n")
        stringToAddToNextMessage = message.substring(nbOfCharsToLastNewLine)
        message = message.slice(0, nbOfCharsToLastNewLine)

        messagesArray.push(message)
    }
    return messagesArray
}

async function sendLongText(bot, chatId, formattedData) {
    const messagesArray = handleLongText(formattedData)
    for await (let message of messagesArray) {
        await bot.sendMessage(chatId, message, startKeyboard)
    }
}

module.exports = { handleLongText, sendLongText }