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

        // dont do that if it's the last message
        if (i < slices - 1) {
            // to prevent markdown error, we must make sure the message is not split in the middle of a markdown element
            nbOfCharsToLastNewLine = message.lastIndexOf("\n\n")
            stringToAddToNextMessage = message.substring(nbOfCharsToLastNewLine)
            message = message.slice(0, nbOfCharsToLastNewLine)
        }

        messagesArray.push(message)
    }
    return messagesArray
}

async function sendLongText(bot, chatId, formattedData, { returnLastMessageId = false } = {}) {
    const messagesArray = handleLongText(formattedData)
    let lastMessage = null
    for await (let message of messagesArray) {
        if (returnLastMessageId && messagesArray.indexOf(message) === messagesArray.length - 1) {
            lastMessage = await bot.sendMessage(chatId, message, {
                parse_mode: "Markdown",
                reply_markup: {
                    force_reply: true
                }
            })
            return lastMessage.message_id
        }
        else {
            await bot.sendMessage(chatId, message, startKeyboard)
        }
    }
}

module.exports = { handleLongText, sendLongText }