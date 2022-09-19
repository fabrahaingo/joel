module.exports = bot => async msg => {
    try {
        // only answer to messages are not replies
        if (!msg.reply_to_message) {
            await bot.sendMessage(
                msg.chat.id,
                "Je ne comprends pas votre message. Tapez /start pour voir les commandes disponibles."
            )
        }
    } catch (error) {
        console.log(error)
    }
}