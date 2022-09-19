const { sendLongText } = require("../utils/handleLongText")

module.exports = bot => async msg => {
    const chatId = msg.chat.id
    try {
        await bot.sendChatAction(chatId, "typing")
        const text = `Un problème ? Merci de contacter @hellofabien ou hellofabien@pm.me en mentionnant votre identifiant Telegram (*${msg.from.id}*))`
        await sendLongText(bot, chatId, text)
    } catch (error) {
        console.log(error)
    }
}