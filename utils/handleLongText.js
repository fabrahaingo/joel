const { startKeyboard } = require("../utils/keyboards")
const tgMaxLength = 4096

function handleLongText(longText) {
    let messagesArray = []
    let message = ''
    let nbOfCharsToLastNewLine = 0
    let stringToAddToNextMessage = ''
    let amountSliced = longText.length / tgMaxLength
    for (let i = 0; i < amountSliced; i++) {
        if (stringToAddToNextMessage.length > 0) {
            message = stringToAddToNextMessage + longText.slice(i * tgMaxLength, (i + 1) * tgMaxLength)
        } else {
            message = longText.slice(i * tgMaxLength, (i + 1) * tgMaxLength)
        }

        // to prevent markdown error, we must make sure the message is not split in the middle of a markdown element
        nbOfCharsToLastNewLine = message.lastIndexOf("\n\n")
        message = message.slice(0, nbOfCharsToLastNewLine)
        stringToAddToNextMessage = longText.slice(nbOfCharsToLastNewLine, (i + 1) * tgMaxLength)

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