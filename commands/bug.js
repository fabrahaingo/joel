const { sendLongText } = require("../utils/handleLongText")

module.exports = bot => async msg => {
    const chatId = msg.chat.id
    try {
        await bot.sendChatAction(chatId, "typing")
        const text = `Un problème ? Essayez de taper "/start" 😉 \n Si ça persiste, merci de contacter @hellofabien ou hellofabien@pm.me en mentionnant votre identifiant Telegram (*${msg.from.id}*), on essaiera de vous aider au plus vite! 👐@`
        await sendLongText(bot, chatId, text)
    } catch (error) {
        console.log(error)
    }
}
