const Users = require('../models/User.js')
const People = require('../models/People.js')
const { startKeyboard } = require("../utils/keyboards")

module.exports = bot => async msg => {
    try {
        // only answer to messages are not replies
        if (!msg.reply_to_message) {
            const usersCount = await Users.countDocuments()
            const peopleCount = await People.countDocuments()
            let text = '📈 JOEL aujourd’hui c’est\n'
            text += `👨‍💻 ${usersCount} utilisateurs\n`
            text += `🕵️ ${peopleCount} personnes suivies\n\n`
            text += `JOEL sait combien vous êtes à l'utiliser mais il ne sait pas qui vous êtes... et il ne cherchera jamais à le savoir! 🛡`
            await bot.sendMessage(msg.chat.id, text, startKeyboard)
        }
    } catch (error) {
        console.log(error)
    }
}
