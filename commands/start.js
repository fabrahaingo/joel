const User = require("../models/User")
const { startKeyboard } = require("../utils/keyboards")

module.exports = bot => async msg => {
    const chatId = msg.chat.id
    try {
        bot.sendChatAction(chatId, "typing")
        // Activate / create a new user
        const tgUser = msg.from
        const user = await User.firstOrCreate(tgUser, chatId)
        if (user.status === "blocked") {
            user.status = "active"
            await user.save()
        }

        const botName = process.env.BOT_NAME
        const botChannel = process.env.BOT_CHANNEL
        const username = tgUser.first_name
            ? `[${tgUser.first_name}](tg://user?id=${tgUser.id})`
            : `@${tgUser.username}`

        const text = `Hello ${username} \u{1F680}
		\n\u{1F41D} ${botName} vous permet de *consulter et suivre les évolutions de postes* de vos amis et connaissances au sein de l'administration française.
		\nPour rester au courant des *nouveautés*, des *corrections* de bugs ainsi que des *améliorations* de JOEL, rejoignez votre channel officiel [@${botChannel}](https://t.me/${botChannel})`

        await bot.sendMessage(chatId, text, startKeyboard)
    } catch (error) {
        console.log(error)
    }
}